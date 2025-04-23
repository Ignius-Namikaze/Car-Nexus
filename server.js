// server.js (10/10 Version - Wikipedia Only)

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // Using node-fetch v2 specifically
const cheerio = require('cheerio');
const fs = require('fs').promises; // Use promises version of fs
const path = require('path');
const NodeCache = require('node-cache'); // For caching Wikipedia results

const app = express();
const PORT = process.env.PORT || 1000; // Use environment variable for port or default to 1000

// Initialize Cache: Check expired items every 10 mins, keep items for 1 hour (3600 seconds)
// Cache stores results from the Wikipedia API for the /api/cardetails endpoint
const wikiCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

// --- Middleware ---
app.use(cors()); // Enable Cross-Origin Resource Sharing for all origins
// Serve static files (HTML, CSS, JS) from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// --- API Endpoint to get the list of cars ---
app.get('/api/cars', async (req, res) => {
    try {
        // Construct the path to car_data.json relative to this server file
        const dataPath = path.join(__dirname, 'car_data.json');
        // Read the JSON file asynchronously
        const data = await fs.readFile(dataPath, 'utf-8');
        // Parse the JSON data and send it as the response
        res.json(JSON.parse(data));
    } catch (error) {
        // Log the error on the server
        console.error("Error reading car data:", error);
        // Send a 500 Internal Server Error response to the client
        res.status(500).json({ error: 'Failed to load car data' });
    }
});

// --- Helper Function: Fetch and Parse Wikipedia Content ---
// Fetches content for a given search term from Wikipedia, cleans it, and extracts relevant info.
// Returns an object: { htmlContent, imageUrl, wikiPageUrl, actualTitle, error, searchTerm }
async function fetchAndParseWikipedia(searchTerm) {
    // Construct the Wikipedia API URL
    const wikiApiUrl = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(searchTerm)}&format=json&prop=text|pageimages|displaytitle&pithumbsize=500&redirects=true&formatversion=2`;
    console.log(`Fetching from Wikipedia API: ${searchTerm}`); // Log the search term

    try {
        // Make the asynchronous request to the Wikipedia API
        const wikiResponse = await fetch(wikiApiUrl);
        // Check if the request was successful
        if (!wikiResponse.ok) {
            console.warn(`Wikipedia API request failed for "${searchTerm}" with status ${wikiResponse.status}`);
            // Return an error object if the fetch failed
            return { error: { code: 'fetch-failed', info: `Wikipedia API request failed with status ${wikiResponse.status}` }, searchTerm };
        }
        // Parse the JSON response from the API
        const wikiData = await wikiResponse.json();

        // Check for errors reported by the Wikipedia API itself
        if (wikiData.error) {
            console.warn(`Wikipedia API Error for "${searchTerm}":`, wikiData.error.info);
            return { error: wikiData.error, searchTerm }; // Return the API error
        }

        // Check if the necessary 'parse' object and 'text' content exist
        if (!wikiData.parse || !wikiData.parse.text) {
            console.warn(`No parseable content found for "${searchTerm}".`);
            return { error: { code: 'no-parse', info: 'No parseable content found.' }, searchTerm };
        }

        // --- Extract Wikipedia Image URL ---
        let wikiImageUrl = null;
        // Prefer the thumbnail source if available
        if (wikiData.parse.thumbnail && wikiData.parse.thumbnail.source) {
            wikiImageUrl = wikiData.parse.thumbnail.source;
        } else if (wikiData.parse.pageimage) {
            // Basic fallback - might just be a filename, not a full URL
            console.log(`Using pageimage as fallback for "${searchTerm}": ${wikiData.parse.pageimage}`);
        }

        // --- Parse and Clean HTML Content ---
        const htmlContent = wikiData.parse.text;
        // Load the HTML content into Cheerio for manipulation
        const $ = cheerio.load(htmlContent);

        // Selectors for common Wikipedia elements to remove (clutter)
        const selectorsToRemove = [
            '.infobox', '.metadata', '.navbox', '.reflist', 'sup.reference',
            '.mw-editsection', '.toc', 'figure', '.thumb', '#coordinates',
            '.mw-kartographer-maplink', '.noprint', '.sidebar', '.sistersitebox',
            '.portalbox', '.ambox', '.stub', 'table.wikitable[style*="float: right"]', // More specific table removal
            '.gallery', '#Further_reading', '#See_also', '#References', '#External_links',
             '.mw-references-wrap', '.catlinks'
        ];
        $(selectorsToRemove.join(', ')).remove();

        // Also remove parent sections if their header was removed by ID matching above
        $('h2').each((i, h2) => {
             const headline = $(h2).find('.mw-headline');
             if (headline.length > 0 && ['Further reading', 'See also', 'References', 'External links'].includes(headline.attr('id'))) {
                 $(h2).nextUntil('h2').remove(); // Remove content between this H2 and the next
                 $(h2).remove(); // Remove the H2 itself
             }
        });


        // Remove empty paragraphs that might be left after removing floated elements
        $('p').each((i, el) => {
            if ($(el).text().trim() === '' && $(el).find('img').length === 0) {
                $(el).remove();
            }
        });

        // --- Extract Cleaned HTML ---
        // Try to get content from the main parser output div
        let cleanedHtml = $('.mw-parser-output').html();
        // Improved Fallback: If mw-parser-output is weak or missing, try grabbing children of bodyContent
        if (!cleanedHtml || cleanedHtml.trim().length < 150) { // Increased threshold
            console.warn(`mw-parser-output extraction might be incomplete for "${searchTerm}". Trying bodyContent children.`);
            // Exclude known navigation/sidebar elements explicitly if they exist within bodyContent
             cleanedHtml = $('#bodyContent').children().not('#mw-navigation, #siteSub, #contentSub, #jump-to-nav').parent().html(); // Try parent to get wrapper
        }
         // Final fallback if content is still minimal
         if (!cleanedHtml || cleanedHtml.trim().length < 50) {
              cleanedHtml = `<p>Content extraction failed or the Wikipedia page is very short. Please check the page directly on Wikipedia.</p>`;
         }

        // --- Extract Page Title and URL ---
        // Get the actual title resolved by Wikipedia (handles redirects)
        const actualTitle = wikiData.parse.title || searchTerm;
        // Construct the direct link to the Wikipedia page (use underscores for spaces)
        const wikiPageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(actualTitle.replace(/ /g, '_'))}`;
        // Get the display title (might include formatting)
        const displayTitle = wikiData.parse.displaytitle || actualTitle;

        // Return the structured result object
        return {
            htmlContent: cleanedHtml,
            imageUrl: wikiImageUrl, // Consistent key for the image from this source
            wikiPageUrl: wikiPageUrl,
            actualTitle: displayTitle, // Use display title for frontend heading
            error: null, // Indicate success
            searchTerm: searchTerm // Include original search term for context
        };

    } catch (fetchError) {
        // Catch any network or other errors during the fetch process
        console.error(`Wikipedia fetch/processing exception for "${searchTerm}":`, fetchError);
        return { error: { code: 'fetch-exception', info: fetchError.message }, searchTerm };
    }
} // end fetchAndParseWikipedia


// --- API Endpoint for Car Model Details ---
app.get('/api/cardetails', async (req, res) => {
    // Get model and brand from query parameters
    const model = req.query.model;
    const brand = req.query.brand;

    // Basic validation: model is required
    if (!model) {
        return res.status(400).json({ error: 'Model query parameter is required' });
    }

    // Construct the primary search term (Brand + Model or just Model)
    const primarySearchTerm = brand ? `${brand} ${model}` : model;
    // Create a unique cache key based on the search term
    const cacheKey = `wiki_details_${primarySearchTerm.toLowerCase().replace(/\s+/g, '_')}`;

    // 1. Check Cache First
    const cachedData = wikiCache.get(cacheKey);
    if (cachedData) {
        console.log(`Cache HIT for Wiki details: ${primarySearchTerm}`);
        // Return cached data immediately if found
        return res.json(cachedData);
    }

    // Cache miss: proceed to fetch from Wikipedia
    console.log(`Cache MISS for Wiki details: ${primarySearchTerm}. Fetching...`);

    try {
        // 2. Fetch Wikipedia Content using the helper function
        let wikiResult = await fetchAndParseWikipedia(primarySearchTerm);

        // 3. Handle "Page Not Found" & Retry Logic (if brand was provided)
        // If the initial search failed specifically because the title was missing, AND we had a brand,
        // try searching *only* for the model name.
        if (wikiResult.error && wikiResult.error.code === 'missingtitle' && brand) {
            console.log(`Initial Wiki search failed for "${primarySearchTerm}". Retrying with model only: "${model}"`);
            // Use a different cache key for the model-only search result
            const modelOnlyCacheKey = `wiki_details_${model.toLowerCase().replace(/\s+/g, '_')}`;
            // Check if the model-only result is already cached
            const modelCached = wikiCache.get(modelOnlyCacheKey);

            if (modelCached) {
                console.log(`Cache HIT for model-only Wiki retry: ${model}`);
                wikiResult = modelCached; // Use the cached model-only result
            } else {
                // Fetch model-only data from Wikipedia
                wikiResult = await fetchAndParseWikipedia(model);
                // If the model-only fetch was successful, cache it
                if (!wikiResult.error) {
                     wikiCache.set(modelOnlyCacheKey, wikiResult);
                     console.log(`Cached Wiki result (model-only) for key: ${modelOnlyCacheKey}`);
                }
            }
        }

        // 4. Handle Final Errors
        // If, after potential retry, we still have an error, return a 404 Not Found
        if (wikiResult.error) {
            console.warn(`Final attempt failed to find Wiki page for "${primarySearchTerm}". Error: ${wikiResult.error.info}`);
            // Send a 404 response to the client
            return res.status(404).json({ error: `Could not find Wikipedia page for "${primarySearchTerm}". Error: ${wikiResult.error.info || 'Unknown error'}` });
        }

        // 5. Prepare Response Data (Success)
        // Structure the data to be sent back to the frontend
        const responseData = {
            htmlContent: wikiResult.htmlContent,
            imageUrl: wikiResult.imageUrl, // Image URL from Wikipedia
            wikiPageUrl: wikiResult.wikiPageUrl,
            actualTitle: wikiResult.actualTitle
        };

        // 6. Cache the Successful Result
        // Determine the correct cache key based on whether the original or retry search succeeded
        const keyToCache = (wikiResult.searchTerm === primarySearchTerm) ? cacheKey : `wiki_details_${model.toLowerCase().replace(/\s+/g, '_')}`;
        // Check if it's already in cache (might be from the retry logic) before setting again
        if (!wikiCache.has(keyToCache)) {
             wikiCache.set(keyToCache, responseData);
             console.log(`Cached final Wiki result for key: ${keyToCache}`);
        }

        // 7. Send Successful Response
        res.json(responseData);

    } catch (error) { // Catch any unexpected errors during the endpoint logic
        console.error(`Unexpected server error processing cardetails for "${primarySearchTerm}":`, error);
        // Send a 500 Internal Server Error response
        res.status(500).json({ error: 'Server error while processing car details: ' + error.message });
    }
});

// --- Root Route ---
// Serve the main index.html file when accessing the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Start the Server ---
app.listen(PORT, () => {
    console.log(`Server successfully started and listening at http://localhost:${PORT}`);
});