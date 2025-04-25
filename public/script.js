document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Element References ---
    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    const resultsContainer = document.getElementById('results');
    const playerContainer = document.getElementById('player');
    const currentTrackElement = document.getElementById('currentTrack');
    const playlistInfoElement = document.getElementById('playlistInfo');
    const audioPlayer = document.getElementById('audioPlayer');
    const ttsPlayer = document.getElementById('ttsPlayer');
    const nextButton = document.getElementById('nextButton');
    const loadingIndicator = document.getElementById('loading');
    const errorElement = document.getElementById('error');

    // --- Application State ---
    let currentPlaylist = null; // { title: string, videos: Array<{id, title}>, currentIndex: number }
    let isTTSPlaying = false;
    let nextAudioInfo = null; // { audioUrl: string, title: string } - Staged track info after TTS

    // --- Utility Functions ---
    const showElement = (el) => el?.classList.remove('hidden');
    const hideElement = (el) => el?.classList.add('hidden');
    const enableButton = (btn) => btn.disabled = false;
    const disableButton = (btn) => btn.disabled = true;

    const showLoading = (message = 'Loading...') => {
        errorElement.classList.add('hidden'); // Hide error when loading starts
        loadingIndicator.querySelector('p').textContent = message;
        showElement(loadingIndicator);
    };
    const hideLoading = () => hideElement(loadingIndicator);

    const showError = (message) => {
        hideLoading(); // Hide loading if error occurs
        errorElement.querySelector('p').textContent = message;
        showElement(errorElement);
        // Optionally hide player if error is critical
        // hideElement(playerContainer);
    };
    const hideError = () => hideElement(errorElement);

    // --- Core Application Logic ---

    /**
     * Performs a search via the backend API.
     */
    async function performSearch() {
        const query = searchInput.value.trim();
        if (!query) {
            showError("Please enter a search term.");
            return;
        }

        showLoading('Searching...');
        hideError();
        disableButton(searchButton);
        resultsContainer.innerHTML = ''; // Clear previous results

        try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            const data = await response.json(); // Always try to parse JSON

            if (!response.ok) {
                // Use error message from API if available, otherwise generic message
                throw new Error(data?.error || `Search failed (Status: ${response.status})`);
            }

            displayResults(data);

        } catch (error) {
            console.error('Search Fetch Error:', error);
            showError(`Search failed: ${error.message}`);
            resultsContainer.innerHTML = '<p style="padding: 1rem; text-align: center;">Search failed.</p>'; // Clear results on error
        } finally {
            hideLoading();
            enableButton(searchButton);
        }
    }

    /**
     * Displays search results in the UI.
     * @param {Array} results - Array of result objects from the API.
     */
    function displayResults(results) {
        resultsContainer.innerHTML = ''; // Clear just in case

        if (!results || results.length === 0) {
            resultsContainer.innerHTML = '<p style="padding: 1rem; text-align: center;">No results found.</p>';
            return;
        }

        results.forEach(item => {
            if (!item.id || !item.title) return; // Skip incomplete items

            const div = document.createElement('div');
            div.classList.add('result-item');
            div.dataset.id = item.id;
            div.dataset.title = item.title;
            // Assuming type 'video' based on API search params
            div.dataset.type = 'video';
            div.setAttribute('role', 'button');
            div.setAttribute('tabindex', '0'); // Make it focusable

            const img = document.createElement('img');
            img.src = item.thumbnail || ''; // Use empty string if no thumbnail
            img.alt = `Thumbnail for ${item.title}`;
            img.onerror = () => { img.style.display = 'none'; }; // Hide broken images
            img.loading = 'lazy'; // Lazy load images

            const infoDiv = document.createElement('div');
            infoDiv.classList.add('info');

            const titleP = document.createElement('p');
            titleP.classList.add('title');
            titleP.textContent = item.title;

            const durationP = document.createElement('p');
            durationP.classList.add('duration');
            durationP.textContent = item.duration || '';

            infoDiv.appendChild(titleP);
            infoDiv.appendChild(durationP);
            div.appendChild(img);
            div.appendChild(infoDiv);
            resultsContainer.appendChild(div);
        });
    }

    /**
     * Handles clicks on search results (event delegation).
     * @param {Event} event - The click event object.
     */
    function handleResultClick(event) {
        const item = event.target.closest('.result-item');
        if (item && item.dataset.id) {
            const id = item.dataset.id;
            const title = item.dataset.title;
            const type = item.dataset.type; // 'video' or 'playlist'

             // Clear previous playlist state immediately
            currentPlaylist = null;
            hideElement(playlistInfoElement);
            hideElement(nextButton);
            disableButton(nextButton); // Also disable it

            showLoading('Loading...'); // General loading message
            hideError();

            // Reset player state visually
            currentTrackElement.textContent = "Loading...";
            audioPlayer.removeAttribute('src'); // Remove old source

            if (type === 'playlist') {
                 fetchPlaylist(id);
            } else {
                 fetchAndPrepareVideo(id, title);
            }
        }
    }

    /**
     * Fetches playlist data and starts playing the first track.
     * @param {string} playlistId - The ID of the playlist to fetch.
     */
    async function fetchPlaylist(playlistId) {
        try {
            const response = await fetch(`/api/playlist?id=${encodeURIComponent(playlistId)}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data?.error || `Failed to load playlist (Status: ${response.status})`);
            }

            if (data.videos && data.videos.length > 0) {
                currentPlaylist = {
                    title: data.title,
                    videos: data.videos,
                    currentIndex: 0,
                };
                console.log(`Loaded playlist: "${data.title}", ${data.videos.length} videos.`);
                updatePlaylistUI();
                showElement(nextButton); // Show next button
                enableButton(nextButton);

                // Prepare the first video
                const firstVideo = currentPlaylist.videos[0];
                fetchAndPrepareVideo(firstVideo.id, firstVideo.title);
            } else {
                throw new Error('Playlist is empty or contains no valid videos.');
            }

        } catch (error) {
            console.error('Playlist Fetch Error:', error);
            showError(`Failed to load playlist: ${error.message}`);
            // Reset playlist state on error
            currentPlaylist = null;
            hideElement(playlistInfoElement);
            hideElement(nextButton);
            disableButton(nextButton);
        } finally {
            // Loading is hidden inside fetchAndPrepareVideo or by showError
        }
    }


    /**
     * Fetches video playback info and prepares it for playing after TTS.
     * @param {string} videoId - The ID of the video.
     * @param {string} title - The title of the video (used for TTS).
     */
    async function fetchAndPrepareVideo(videoId, title) {
        try {
            const response = await fetch(`/api/play?id=${encodeURIComponent(videoId)}`);
            const data = await response.json();

            if (!response.ok) {
                 throw new Error(data?.error || `Failed to load track (Status: ${response.status})`);
            }

            // Stage the info needed *after* TTS completes
            nextAudioInfo = {
                audioUrl: data.audioUrl,
                title: data.title || title, // Prefer title from API, fallback to search result title
            };

            // Update UI immediately for playlist context
            if (currentPlaylist) {
                updatePlaylistUI(); // Ensure playlist counter is correct
            } else {
                // For single tracks, update the display title now (before TTS)
                 currentTrackElement.textContent = nextAudioInfo.title;
                 showElement(playerContainer);
            }

            // Play TTS, the 'ended' event of ttsPlayer will trigger playMainAudio
            playTTS(`Changing now to ${nextAudioInfo.title}`);

        } catch (error) {
            console.error('Video Fetch/Prepare Error:', error);
            showError(`Failed to load track: ${error.message}`);
            nextAudioInfo = null; // Clear staged info on error
            // Hide player if it was shown for a single track
            if (!currentPlaylist) hideElement(playerContainer);
        } finally {
            // Loading indicator should be hidden by playTTS or showError
             hideLoading();
        }
    }

    /**
     * Plays the Text-to-Speech announcement.
     * @param {string} text - The text to speak.
     */
    function playTTS(text) {
        if (!text) {
            // If no text, proceed directly to playing the main audio if staged
            if (nextAudioInfo) {
                 playMainAudio();
            }
            return;
        }

        console.log('TTS: Requesting speech for:', text);
        isTTSPlaying = true;
        audioPlayer.pause(); // Ensure main audio is paused

        // Set source and play. Errors handled by ttsPlayer listeners.
        ttsPlayer.src = `/api/tts?text=${encodeURIComponent(text)}`;
        ttsPlayer.play().catch(e => {
            console.error("TTS Playback Initiation Error:", e);
             // If TTS immediately fails, attempt to play main audio directly
             isTTSPlaying = false;
             playMainAudio();
        });
    }

     /**
     * Plays the main audio track using the staged `nextAudioInfo`.
     */
    function playMainAudio() {
        if (!nextAudioInfo) {
            console.log("playMainAudio called but nextAudioInfo is null.");
            // Maybe show an error or just do nothing?
            if (!currentPlaylist) { // Don't hide player if in playlist mode
                 hideElement(playerContainer);
            }
            return;
        }

        console.log("Playing main audio:", nextAudioInfo.title);
        currentTrackElement.textContent = nextAudioInfo.title; // Ensure title is set
        audioPlayer.src = nextAudioInfo.audioUrl;

        // Play the audio. Handle potential browser restrictions.
        const playPromise = audioPlayer.play();
        if (playPromise !== undefined) {
            playPromise.then(_ => {
                // Playback started successfully
                console.log("Playback started for:", nextAudioInfo.title);
                showElement(playerContainer); // Ensure player is visible
                hideLoading(); // Ensure loading is hidden
                hideError(); // Hide any previous non-critical errors
            }).catch(error => {
                console.error("Audio Playback Error:", error);
                // Common issue: Autoplay blocked by browser
                if (error.name === 'NotAllowedError') {
                    showError('Playback blocked. Please press the play button on the player to start.');
                    // Show player so user can interact
                    showElement(playerContainer);
                    // We might want to show a manual play button here instead of relying only on controls
                } else {
                    showError(`Playback error: ${error.message}`);
                }
                 hideLoading();
            });
        }

        // Clear the staged info now that we've attempted to play it
        nextAudioInfo = null;
    }


    /**
     * Plays the next track in the current playlist.
     */
    function playNextTrackInPlaylist() {
        if (!currentPlaylist || currentPlaylist.videos.length === 0) return;

        disableButton(nextButton); // Disable while loading next
        currentPlaylist.currentIndex++;
        if (currentPlaylist.currentIndex >= currentPlaylist.videos.length) {
            currentPlaylist.currentIndex = 0; // Loop back
            console.log('Playlist looping back to start.');
             // Optional: Announce loop with TTS? Short delay might be nice.
             // setTimeout(() => playTTS("Playlist restarting"), 500);
        }

        const nextVideo = currentPlaylist.videos[currentPlaylist.currentIndex];

        if (nextVideo && nextVideo.id) {
            console.log(`Playlist: Loading next track (${currentPlaylist.currentIndex + 1}/${currentPlaylist.videos.length}): ${nextVideo.title}`);
             showLoading('Loading next track...'); // Show loading indicator
             fetchAndPrepareVideo(nextVideo.id, nextVideo.title); // This will handle TTS and playing
             updatePlaylistUI(); // Update text immediately
        } else {
            console.error('Playlist Error: Could not find next video data.');
            showError('Error in playlist. Cannot play next track.');
            // Stop playlist mode
            currentPlaylist = null;
            hideElement(playlistInfoElement);
            hideElement(nextButton);
        }
         // Re-enable button after fetchAndPrepareVideo starts/finishes or errors out
         // It might be better to enable it inside fetchAndPrepareVideo's finally block?
         // For now, let's enable it here, assuming fetchAndPrepareVideo handles UI state.
         enableButton(nextButton);
    }

    /**
     * Updates the playlist information display in the UI.
     */
    function updatePlaylistUI() {
        if (currentPlaylist) {
            playlistInfoElement.textContent = `Playlist: ${currentPlaylist.title} (${currentPlaylist.currentIndex + 1} / ${currentPlaylist.videos.length})`;
            showElement(playlistInfoElement);
        } else {
            hideElement(playlistInfoElement);
        }
    }

    // --- Event Listeners Setup ---
    searchButton.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performSearch();
        }
    });

    // Use event delegation for results container
    resultsContainer.addEventListener('click', handleResultClick);
    resultsContainer.addEventListener('keypress', (e) => { // Allow activation with Enter key
         if (e.key === 'Enter') {
             handleResultClick(e);
         }
     });


    // Main audio player events
    audioPlayer.addEventListener('ended', () => {
        console.log('Audio ended event');
        if (currentPlaylist) {
            playNextTrackInPlaylist();
        } else {
            currentTrackElement.textContent = 'Finished';
            // Optionally clear the player src?
            // audioPlayer.removeAttribute('src');
        }
    });

    audioPlayer.addEventListener('error', (e) => {
        console.error('Audio Player Error:', e);
        // Extract a more useful error message if possible
        let errorMsg = 'An unknown playback error occurred.';
        if (e.target.error) {
            switch (e.target.error.code) {
                case MediaError.MEDIA_ERR_ABORTED: errorMsg = 'Playback aborted.'; break;
                case MediaError.MEDIA_ERR_NETWORK: errorMsg = 'Network error caused playback failure.'; break;
                case MediaError.MEDIA_ERR_DECODE: errorMsg = 'Audio decoding error.'; break;
                case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: errorMsg = 'Audio format not supported.'; break;
                default: errorMsg = `Playback error: ${e.target.error.message || 'Unknown code'}`;
            }
        }
        showError(errorMsg + " Try another track.");
        // Attempt to play next if in a playlist after a short delay
        if (currentPlaylist) {
             console.log("Attempting to play next track after error...");
            setTimeout(playNextTrackInPlaylist, 1500);
        } else {
            hideElement(playerContainer); // Hide player on error for single track
        }
    });

     // TTS audio player events
     ttsPlayer.addEventListener('ended', () => {
         console.log('TTS ended event');
         isTTSPlaying = false;
         // TTS finished, now play the main audio that was staged
         playMainAudio();
     });

     ttsPlayer.addEventListener('error', (e) => {
         console.error('TTS Player Error:', e);
         isTTSPlaying = false;
         showError('TTS announcement failed. Playing track directly.'); // Inform user
         // Don't block main audio if TTS fails; play the staged audio immediately.
         playMainAudio();
     });


    // Next button for playlists
    nextButton.addEventListener('click', playNextTrackInPlaylist);

    // --- Initial Page Load ---
    console.log('Chill Music App Initialized.');
    // Hide elements that shouldn't be visible initially
    hideElement(playerContainer);
    hideElement(loadingIndicator);
    hideElement(errorElement);
    hideElement(nextButton);
    disableButton(nextButton);
    hideElement(playlistInfoElement);

});
