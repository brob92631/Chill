const express = require('express');
const ytdl = require('ytdl-core');
const YouTube = require('youtube-sr').default; // CommonJS import style
const gtts = require('gtts');

const app = express();

// Middleware for CORS - Important for Vercel dev and potentially production
// Allow requests from the frontend origin during development
// In production, Vercel usually handles this if frontend/backend are same origin.
// Add more specific origins if needed.
// const cors = require('cors');
// app.use(cors()); // Enable CORS for all origins, or configure specific ones


// --- API Endpoints ---

/**
 * @route GET /api/search
 * @desc Search YouTube for videos based on a query.
 * Appends "chill relaxing music" to focus results.
 * @param {string} q - The search query.
 * @returns {JSON} - Array of simplified video results or error.
 */
app.get('/api/search', async (req, res) => {
    const query = req.query.q;
    if (!query) {
        return res.status(400).json({ error: 'Search query "q" is required.' });
    }

    const searchQuery = `${query} chill relaxing music`;
    console.log(`API: Searching YouTube for: "${searchQuery}"`);

    try {
        // youtube-sr is suitable for getting search results lists.
        const results = await YouTube.search(searchQuery, {
            limit: 15,
            type: 'video', // Focus on videos for simplicity
            safeSearch: true,
        });

        // Map to a simpler format for the frontend
        const simplifiedResults = results
            .map(item => ({
                id: item.id,
                title: item.title,
                thumbnail: item.thumbnail?.url, // Safely access thumbnail URL
                duration: item.durationFormatted,
            }))
            .filter(item => item.id && item.title); // Ensure basic data exists

        console.log(`API: Found ${simplifiedResults.length} video results.`);
        res.status(200).json(simplifiedResults);

    } catch (error) {
        console.error('API Search Error:', error);
        // Provide a more generic error to the client
        res.status(500).json({ error: 'Failed to search YouTube.', details: error.message });
    }
});

/**
 * @route GET /api/play
 * @desc Get playback info (direct audio URL, title, duration) for a specific video ID.
 * Uses ytdl-core to find the best audio-only format.
 * @param {string} id - The YouTube video ID.
 * @returns {JSON} - Playback info or error.
 */
app.get('/api/play', async (req, res) => {
    const videoId = req.query.id;
    if (!videoId || !ytdl.validateID(videoId)) {
        return res.status(400).json({ error: 'A valid YouTube video ID "id" is required.' });
    }

    console.log(`API: Getting playback info for video ID: ${videoId}`);

    try {
        // ytdl-core is used here to get detailed info and stream URLs.
        const info = await ytdl.getInfo(videoId);

        // Filter for audio-only formats and choose the best available.
        // Prioritize 'opus' or 'webm' for efficiency if available, then highest bitrate mp4/m4a.
        const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
        let format = ytdl.chooseFormat(audioFormats, { quality: 'highestaudio', filter: 'audioonly' });

        // Fallback if chooseFormat doesn't find a suitable one (less common now)
        if (!format) {
             console.warn(`API: ytdl.chooseFormat didn't find optimal format for ${videoId}, trying manual sort.`);
             format = audioFormats.sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
        }

        if (!format || !format.url) {
            console.error(`API: No suitable audio format found for video ID: ${videoId}`);
            return res.status(404).json({ error: 'No suitable audio-only format found for this video.' });
        }

        console.log(`API: Found audio format - itag: ${format.itag}, bitrate: ${format.audioBitrate}kbps, mime: ${format.mimeType}`);

        // Send the direct stream URL and metadata to the client.
        // The client's <audio> tag will handle the streaming directly from YouTube's servers.
        res.status(200).json({
            audioUrl: format.url,
            title: info.videoDetails.title,
            durationSeconds: parseInt(info.videoDetails.lengthSeconds, 10) || 0,
        });

    } catch (error) {
        console.error(`API Play Error (ID: ${videoId}):`, error);
         // Handle common ytdl errors specifically
         if (error.message.includes('private') || error.message.includes('unavailable') || error.statusCode === 404) {
             return res.status(404).json({ error: 'Video is private, unavailable, or not found.' });
         }
         if (error.message.includes('age-restricted') || error.statusCode === 403) {
             // Note: ytdl-core often struggles with age-restricted content without cookies/authentication
             return res.status(403).json({ error: 'Video is age-restricted and cannot be played directly.' });
         }
         if (error.message.includes('consent')) {
             return res.status(403).json({ error: 'Video requires consent and cannot be played directly.' });
         }
        // Generic error for other issues
        res.status(500).json({ error: 'Failed to get video playback information.', details: error.message });
    }
});


/**
 * @route GET /api/playlist
 * @desc Get items (videos) within a YouTube playlist.
 * Uses youtube-sr as it's generally efficient for listing playlist contents.
 * @param {string} id - The YouTube playlist ID.
 * @returns {JSON} - Playlist title and list of videos or error.
 */
app.get('/api/playlist', async (req, res) => {
    const playlistId = req.query.id;
     // Basic ID format check (doesn't guarantee validity)
    if (!playlistId || !/^[a-zA-Z0-9_-]+$/.test(playlistId)) {
        return res.status(400).json({ error: 'A valid YouTube playlist ID "id" is required.' });
    }

    console.log(`API: Fetching playlist items for ID: ${playlistId}`);

    try {
        // youtube-sr's getPlaylist is suitable here.
        // Limit the number of videos fetched to keep response times reasonable.
        const playlist = await YouTube.getPlaylist(playlistId, { limit: 50 }); // Limit to 50 videos

        if (!playlist || !playlist.videos || playlist.videos.length === 0) {
             console.warn(`API: Playlist not found or empty: ${playlistId}`);
            return res.status(404).json({ error: 'Playlist not found or is empty.' });
        }

        // Map to a simpler format
        const videos = playlist.videos
            .map(video => ({
                id: video.id,
                title: video.title,
                duration: video.durationFormatted, // Note: duration might be less accurate here
            }))
            .filter(v => v.id && v.title); // Filter out incomplete entries

        console.log(`API: Found ${videos.length} videos in playlist "${playlist.title}".`);
        res.status(200).json({
            title: playlist.title || 'Playlist',
            videos: videos,
        });

    } catch (error) {
        console.error(`API Playlist Error (ID: ${playlistId}):`, error);
         if (error.message.includes('not found') || error.message.includes('Invalid Playlist ID')) {
             return res.status(404).json({ error: 'Playlist not found or invalid ID.' });
         }
        res.status(500).json({ error: 'Failed to retrieve playlist information.', details: error.message });
    }
});


/**
 * @route GET /api/tts
 * @desc Generates Text-to-Speech audio using Google Translate TTS (via gtts).
 * Streams the audio directly back to the client.
 * @param {string} text - The text to synthesize.
 * @returns {Stream} - MPEG audio stream or JSON error.
 */
app.get('/api/tts', (req, res) => {
    const text = req.query.text;
    if (!text) {
        return res.status(400).json({ error: 'Text query parameter "text" is required.' });
    }
    // Limit text length to prevent abuse/long processing
    if (text.length > 200) {
         return res.status(400).json({ error: 'Text length exceeds maximum limit (200 characters).' });
    }


    console.log(`API: Generating TTS for: "${text.substring(0, 50)}..."`);

    try {
        // gtts library usage: create instance, set headers, pipe stream.
        const speech = new gtts(text, 'en'); // Use English voice

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', 'inline'); // Suggest browser plays it directly
        res.setHeader('Cache-Control', 'no-cache'); // Don't cache TTS responses

        // Stream the generated audio directly to the response object.
        speech.stream().pipe(res);

    } catch (error) {
        console.error('API TTS Error:', error);
        // Check if error is from gtts itself or streaming
        res.status(500).json({ error: 'Failed to generate TTS audio.', details: error.message });
    }
});


// --- Vercel Export ---
// This single export is what Vercel uses to handle all requests defined above.
module.exports = app;

// --- Local Development Server (for `vercel dev`) ---
// This part is ignored by Vercel deployment but useful for local testing.
// It requires running `npm start` (which executes `vercel dev`).
// Vercel dev automatically handles serving static files from 'public' based on vercel.json
// No need for explicit static serving or fallback routes here when using `vercel dev`.
