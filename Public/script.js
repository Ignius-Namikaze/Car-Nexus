// public/script.js - 10/10 Version (Corrected for Robust Initialization)
document.addEventListener('DOMContentLoaded', () => {
    // --- Get DOM Elements ---
    const networkContainer = document.getElementById('mynetwork');
    const loadingIndicator = document.getElementById('loading');
    const detailsPanel = document.getElementById('details-panel');
    const detailsContent = document.getElementById('details-content');
    const detailsLoading = document.getElementById('details-loading');
    const closePanelBtn = document.getElementById('close-panel-btn');
    const detailsImageContainer = document.getElementById('details-image-container');
    const detailsImage = document.getElementById('details-image');
    const imagePlaceholder = document.getElementById('image-placeholder');
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    const graphStatusOverlay = document.getElementById('graph-status-overlay');
    // Filter Controls
    const filterControls = document.getElementById('filter-controls');
    const brandFilterSelect = document.getElementById('brand-filter');
    const typeFilterSelect = document.getElementById('type-filter');
    const yearSlider = document.getElementById('year-slider');
    const yearRangeDisplay = document.getElementById('year-range-display');
    const resetFiltersBtn = document.getElementById('reset-filters-btn');
    const toggleFiltersBtn = document.getElementById('toggle-filters-btn');


    // --- State Variables ---
    let network = null;
    let allNodesDataSet = new vis.DataSet(); // Holds ALL nodes, visibility controlled by 'hidden'
    let allEdgesDataSet = new vis.DataSet(); // Holds ALL edges
    let allNodesRaw = []; // Raw data array for lookups and filtering
    allNodesRaw.uniqueTypes = []; // Initialize these properties
    allNodesRaw.uniqueBrands = [];
    let brandChoices = null; // Choices.js instance
    let typeChoices = null; // Choices.js instance
    let yearSliderInstance = null; // noUiSlider instance
    let minYear = 1900, maxYear = new Date().getFullYear(); // Year range defaults
    let filterDebounceTimer = null;
    const FILTER_DEBOUNCE_DELAY = 500; // Debounce for filters

    // --- Theme Colors (Example, ensure matches CSS) ---
     const COLORS = {
        bgDark: '#16181d', bgMedium: '#21252b', bgLight: '#2c313a',
        textPrimary: '#f1f3f5', textSecondary: '#adb5bd',
        accent: '#ff6b00', accentHover: '#e05d00',
        brand: '#0ea5e9', brandHover: '#0284c7',
        model: '#64748b', modelBorder: '#475569',
        edge: 'rgba(150, 165, 170, 0.3)', highlightEdge: 'rgba(255, 107, 0, 0.7)',
        selectBorder: '#ff6b00', hoverBg: 'rgba(236, 240, 241, 0.1)'
    };

    // --- Debounce Function ---
    function debounce(func, delay) {
         return function(...args) {
             clearTimeout(filterDebounceTimer);
             filterDebounceTimer = setTimeout(() => {
                 func.apply(this, args);
             }, delay);
         };
     }

    // --- Initialization ---
    async function initializeApp() {
        showLoadingMessage("Igniting Engine... Preparing Graph...");
        if (filterControls) filterControls.style.display = 'none'; // Hide filters until graph loaded

        try {
            const response = await fetch('/api/cars');
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            const carData = await response.json();

            const { nodes, edges, uniqueTypes, uniqueBrands } = processCarData(carData);
            allNodesRaw = nodes; // Store processed nodes array
            allNodesRaw.uniqueTypes = uniqueTypes; // Store unique types
            allNodesRaw.uniqueBrands = uniqueBrands; // Store unique brands

            calculateYearRange(nodes); // Calculate min/max year from data

            allNodesDataSet.add(nodes);
            allEdgesDataSet.add(edges);

            initializeGraphVisualization(); // Create the graph *before* filters if filters depend on graph data? (No, filters depend on processed data)
            initializeFilterControls(); // Setup filters *after* data is processed and ranges calculated

            // --- Event Listeners --- (Add checks for element existence)
            if (network) {
                network.on('click', handleNodeClick);
            } else { console.error("Network not initialized for click listener."); }

            if(searchInput) searchInput.addEventListener('input', debouncedApplyFilters);
            if(clearSearchBtn) clearSearchBtn.addEventListener('click', clearSearch);
            if(resetFiltersBtn) resetFiltersBtn.addEventListener('click', resetAllFilters);
            if(toggleFiltersBtn) toggleFiltersBtn.addEventListener('click', toggleFilterSidebar);
            if(closePanelBtn) closePanelBtn.addEventListener('click', () => { if(detailsPanel) detailsPanel.classList.remove('visible'); });


            // Close filter sidebar if clicking outside on mobile
            document.body.addEventListener('click', (e) => {
                 if (window.innerWidth <= 767 && filterControls && filterControls.classList.contains('open')) {
                     // Check if the click is outside the filter sidebar AND not on the toggle button
                     if (!filterControls.contains(e.target) && toggleFiltersBtn && !toggleFiltersBtn.contains(e.target)) {
                         closeFilterSidebar();
                     }
                 }
            });
             // Add listener for the mobile filter close button (pseudo-element) area
             if(filterControls) {
                 filterControls.addEventListener('click', handleMobileFilterCloseClick);
             }


        } catch (error) {
            console.error('Failed to initialize application:', error);
            showLoadingMessage(`Engine failed: ${error.message}`, true);
            if(networkContainer) networkContainer.style.visibility = 'hidden';
        }
    } // end initializeApp

    // --- Data Processing ---
    function processCarData(carData) {
        const nodes = []; const edges = []; let nodeIdCounter = 0;
        const uniqueTypesSet = new Set(); // Use Set for efficiency
        const uniqueBrandsSet = new Set(); // Use Set for efficiency

        carData.forEach(brandData => {
            if (!brandData || !brandData.brand) return; // Skip invalid brand entries
            uniqueBrandsSet.add(brandData.brand);
            nodeIdCounter++;
            const brandId = `brand_${brandData.brand.toLowerCase().replace(/[^a-z0-9]/g, '')}_${nodeIdCounter}`;
            nodes.push({ id: brandId, label: brandData.brand, group: 'brands', title: `Brand: ${brandData.brand}` });

            if (Array.isArray(brandData.models)) {
                brandData.models.forEach(modelData => {
                    let modelName, soundLink = null, startYear = null, endYear = null, isCurrent = false, type = "Unknown";

                    // Ensure modelData is a valid object with a name
                    if (typeof modelData === 'object' && modelData !== null && typeof modelData.name === 'string' && modelData.name.trim() !== '') {
                        modelName = modelData.name.trim();
                        soundLink = modelData.soundLink || null;
                        startYear = parseInt(modelData.startYear) || null; // Default to null if parsing fails
                        isCurrent = modelData.isCurrent === true;
                         // End year calculation: if current, null. If endYear is given and valid, use it. Otherwise, fallback to startYear if it exists.
                        endYear = isCurrent ? null : (parseInt(modelData.endYear) || (startYear || null) );
                        type = modelData.type || "Unknown";
                        if (type.trim() === "") type = "Unknown"; // Handle empty type string
                    } else {
                        console.warn(`Skipping invalid model data for brand "${brandData.brand}":`, modelData);
                        return; // Skip this invalid model entry
                     }

                    if (!type || type.trim() === "") type = "Unknown"; // Ensure type is not empty
                    uniqueTypesSet.add(type);

                    nodeIdCounter++;
                    const modelSanitized = modelName.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const modelId = `model_${brandId}_${modelSanitized}_${nodeIdCounter}`;

                    // Determine year display string more carefully
                    let yearInfo = '';
                    if (startYear && isCurrent) {
                         yearInfo = `[${startYear} - Present]`;
                    } else if (startYear && endYear && startYear !== endYear) {
                         yearInfo = `[${startYear} - ${endYear}]`;
                    } else if (startYear) {
                         yearInfo = `[${startYear}]`; // Only start year known/same as end
                    }

                    let tooltip = `Model: ${brandData.brand} ${modelName} (${type}) ${yearInfo}`.trim();

                    nodes.push({
                        id: modelId, label: modelName, group: 'models',
                        brand: brandData.brand, brandId: brandId,
                        soundLink: soundLink, startYear: startYear, endYear: endYear,
                        isCurrent: isCurrent, modelType: type,
                        hidden: false, // Initially visible
                        title: tooltip
                    });
                    edges.push({ id: `edge_${modelId}_${brandId}`, from: modelId, to: brandId, hidden: false });
                });
            }
        });

        const sortedUniqueTypes = [...uniqueTypesSet].sort();
        const sortedUniqueBrands = [...uniqueBrandsSet].sort();
        console.log(`Processed ${nodes.length} nodes, ${edges.length} edges. Found types: ${sortedUniqueTypes.join(', ')}`);

        return { nodes, edges, uniqueTypes: sortedUniqueTypes, uniqueBrands: sortedUniqueBrands }; // Return unique sets
    } // end processCarData


    function calculateYearRange(nodes) {
         let currentMin = Infinity, currentMax = -Infinity;
         const currentFullYear = new Date().getFullYear();
         nodes.forEach(node => {
             if (node.group === 'models' && node.startYear) { // Only consider nodes with a valid startYear
                 currentMin = Math.min(currentMin, node.startYear);
                 // Determine effective end year for max calculation
                 let effectiveEndYear = node.isCurrent ? currentFullYear : (node.endYear || node.startYear); // Use current year for 'Present', fallback to startYear if end is missing
                 // Ensure effectiveEndYear is a valid number before comparing
                 if (effectiveEndYear && !isNaN(effectiveEndYear)) {
                      currentMax = Math.max(currentMax, effectiveEndYear);
                 }
             }
         });

         // Assign final min/max with defaults if no valid years found
         minYear = (currentMin === Infinity || isNaN(currentMin)) ? 1900 : currentMin;
         maxYear = (currentMax === -Infinity || isNaN(currentMax)) ? currentFullYear : currentMax;

         // Final sanity check: Ensure minYear is not greater than maxYear
         if (minYear > maxYear) {
              console.warn(`Min year (${minYear}) calculated higher than max year (${maxYear}). Resetting defaults.`);
              minYear = 1900;
              maxYear = currentFullYear;
         }
         console.log(`Calculated year range for slider: ${minYear} - ${maxYear}`);
     } // end calculateYearRange


    // --- Filter Control Initialization ---
    function initializeFilterControls() {
        // Ensure elements exist
        if (!brandFilterSelect || !typeFilterSelect || !yearSlider || !yearRangeDisplay) {
             console.error("Filter control elements not found in the DOM. Cannot initialize filters.");
             if(yearRangeDisplay) yearRangeDisplay.textContent = "Error: Controls Missing";
             return;
        }
        // Ensure helper libraries are loaded
        if (typeof Choices === 'undefined') { console.error("Choices.js library not loaded."); return; }
         if (typeof noUiSlider === 'undefined' || typeof wNumb === 'undefined') {
             console.error("noUiSlider or wNumb library not loaded.");
             if(yearRangeDisplay) yearRangeDisplay.textContent = "Error: Slider Lib Missing.";
             if(yearSlider) yearSlider.style.display = 'none';
             return;
        }

        // --- Brand Filter ---
        try {
            const brandOptions = allNodesRaw.uniqueBrands?.map(brand => ({ value: brand, label: brand })) || [];
            brandChoices = new Choices(brandFilterSelect, {
                 removeItemButton: true, allowHTML: false, shouldSort: false, placeholder: true, placeholderValue: 'Select Brands...',
                 classNames: { containerOuter: 'choices filter-select-outer', containerInner: 'choices__inner filter-select-inner' }
             });
            if (brandOptions.length > 0) brandChoices.setChoices(brandOptions, 'value', 'label', false);
            else console.warn("No brand options found to populate filter.");
            brandFilterSelect.addEventListener('change', debouncedApplyFilters);
        } catch (e) { console.error("Error initializing Brand Choices.js:", e); }

        // --- Type Filter ---
         try {
            const typeOptions = allNodesRaw.uniqueTypes?.map(type => ({ value: type, label: type })) || [];
            typeChoices = new Choices(typeFilterSelect, {
                 removeItemButton: true, allowHTML: false, shouldSort: false, placeholder: true, placeholderValue: 'Select Types...',
                 classNames: { containerOuter: 'choices filter-select-outer', containerInner: 'choices__inner filter-select-inner' }
            });
             if (typeOptions.length > 0) typeChoices.setChoices(typeOptions, 'value', 'label', false);
             else console.warn("No type options found to populate filter.");
            typeFilterSelect.addEventListener('change', debouncedApplyFilters);
         } catch (e) { console.error("Error initializing Type Choices.js:", e); }


        // --- Year Slider ---
        try {
            // Check if minYear is strictly less than maxYear before creating
            if (minYear < maxYear) {
                yearSliderInstance = noUiSlider.create(yearSlider, {
                    range: { 'min': minYear, 'max': maxYear },
                    start: [minYear, maxYear],
                    connect: true, step: 1,
                    tooltips: [wNumb({ decimals: 0 }), wNumb({ decimals: 0 })], // Use wNumb directly for tooltips
                    format: wNumb({ decimals: 0 }),
                    pips: { mode: 'positions', values: [0, 25, 50, 75, 100], density: 4, format: wNumb({ decimals: 0 }) }
                });
                yearSliderInstance.on('update', (values, handle, unencoded) => {
                    yearRangeDisplay.textContent = `${unencoded[0]} - ${unencoded[1]}`;
                });
                yearSliderInstance.on('slide', debouncedApplyFilters);
                yearSlider.style.display = 'block'; // Ensure visible if created
            } else {
                 // Handle the case where minYear >= maxYear (e.g., only one year in data)
                 console.warn(`Year slider not created: minYear (${minYear}) >= maxYear (${maxYear}).`);
                 yearSlider.style.display = 'none'; // Hide the slider element
                 yearRangeDisplay.textContent = `Year: ${minYear}`; // Update display
                 yearSliderInstance = null; // Ensure instance is null
            }
        } catch (e) {
            console.error("Error initializing noUiSlider:", e);
            if(yearRangeDisplay) yearRangeDisplay.textContent = "Slider initialization error.";
            if (yearSlider) yearSlider.style.display = 'none';
            yearSliderInstance = null;
        }

        if(filterControls) filterControls.style.display = 'block'; // Show filter container if it exists
    } // end initializeFilterControls


    // --- Graph Visualization ---
    function initializeGraphVisualization() {
        const data = { nodes: allNodesDataSet, edges: allEdgesDataSet };
         const options = {
              nodes: {
                  borderWidth: 1.5, borderWidthSelected: 4,
                  font: { color: 'var(--text-primary)', size: 14, face: 'Lato, sans-serif', strokeWidth: 0 },
                  shapeProperties: { interpolation: false }, hidden: false,
                  color: { border: 'var(--model-border)', background: 'var(--model-color)', highlight: { border: 'var(--selectBorder)', background: 'var(--accent-color)' }, hover: { border: 'var(--brand-color)', background: 'var(--hoverBg)' } },
                  scaling: { label: { enabled: true, min: 14, max: 22 } }
              },
              edges: {
                  width: 0.8, color: { color: 'var(--edge-color)', highlight: 'var(--accent-color)', hover: 'var(--brand-color)' },
                  hoverWidth: 1.5, selectionWidth: 2, smooth: { enabled: true, type: "continuous", roundness: 0.4 }, hidden: false
              },
              physics: {
                  solver: 'barnesHut', barnesHut: { gravitationalConstant: -25000, centralGravity: 0.15, springLength: 220, springConstant: 0.02, damping: 0.2, avoidOverlap: 0.4 },
                  stabilization: { enabled: true, iterations: 400, fit: true }, adaptiveTimestep: true
              },
              interaction: { hover: true, hoverConnectedEdges: true, tooltipDelay: 100, navigationButtons: true, keyboard: true, zoomView: true, dragView: true },
              groups: {
                  brands: { shape: 'dot', size: 40, mass: 5, font: { size: 20, face: 'Orbitron, sans-serif', strokeWidth: 1, strokeColor: 'var(--bg-medium)', color: 'var(--text-primary)' }, color: { border: 'var(--brand-color)', background: 'var(--brand-color)', highlight: { border: 'var(--selectBorder)', background: 'var(--brand-hover)' }, hover: { border: 'var(--selectBorder)', background: 'var(--brand-hover)' } } },
                  models: { shape: 'dot', size: 17, mass: 1, font: { size: 14, face: 'Lato, sans-serif', color: 'var(--text-primary)' }, color: { border: 'var(--model-border)', background: 'var(--model-color)', highlight: { border: 'var(--selectBorder)', background: 'var(--accent-color)' }, hover: { border: 'var(--brand-color)', background: 'var(--hoverBg)' } } },
                  clusters: { shape: 'hexagon', size: 45, mass: 6, font: { color: '#FFFFFF', size: 16, face: 'Orbitron, sans-serif', strokeWidth: 1, strokeColor: '#000000' }, color: { border: 'var(--accent-color)', background: 'var(--accent-hover)' }, labelHighlightBold: true, borderWidth: 3 }
              }
          }; // End options

        try {
             network = new vis.Network(networkContainer, data, options);

             network.on('stabilizationProgress', (params) => {
                 const progress = Math.round(params.iterations / params.total * 100);
                 showLoadingMessage(`Arranging Models... ${progress}%`);
             });

             network.once('stabilizationIterationsDone', () => {
                 console.log("Graph stabilized. Applying clustering.");
                 showLoadingMessage("Applying Initial Clustering...");
                  applyClustering();
                 setTimeout(() => {
                      if(loadingIndicator) loadingIndicator.style.display = 'none';
                      if(networkContainer) networkContainer.style.visibility = 'visible';
                 }, 200);
              });
        } catch(e) {
            console.error("Error creating Vis.js network:", e);
            showLoadingMessage("Error creating graph visualization.", true);
        }
    } // end initializeGraphVisualization


    // --- Clustering Logic ---
    function applyClustering() {
         if (!network || !allNodesDataSet || !allEdgesDataSet) return;
         const clusterOptions = {
             joinCondition: (childOptions) => childOptions.group === 'models',
             processProperties: (clusterOptions, childNodes) => {
                 const modelCount = childNodes.length;
                 let brandId = null;
                 const firstChild = childNodes[0];
                 if (firstChild?.id) {
                     const edges = allEdgesDataSet.get({ filter: edge => edge.from === firstChild.id });
                     if (edges.length > 0) brandId = edges[0].to;
                 }
                 const brandNode = brandId ? allNodesDataSet.get(brandId) : null;

                 clusterOptions.label = `${brandNode ? brandNode.label : ''}\n(${modelCount} Models)`;
                 clusterOptions.title = `Brand: ${brandNode ? brandNode.label : 'Group'} - ${modelCount} models (Click to expand)`;
                 clusterOptions.color = brandNode?.color ? JSON.parse(JSON.stringify(brandNode.color)) : { border: 'var(--accent-color)', background: 'var(--accent-hover)' };
                 clusterOptions.mass = 4 + modelCount * 0.1;
                 clusterOptions.id = `cluster_${brandId || Date.now()}`;
                 return clusterOptions;
             },
             clusterNodeProperties: { group: 'clusters', borderWidth: 3 }
         };

         const brandIds = allNodesDataSet.getIds({ filter: node => node.group === 'brands' });
         brandIds.forEach(brandId => {
             try {
                 const modelCount = allEdgesDataSet.get({ filter: edge => edge.to === brandId }).length;
                 if (modelCount > 5) {
                     network.clusterByConnection(brandId, clusterOptions);
                 }
             } catch (e) { console.error(`Error clustering brand ${brandId}:`, e); }
         });
         console.log("Clustering applied.");
     } // end applyClustering


    // --- Filtering Logic ---
    const debouncedApplyFilters = debounce(() => applyFilters(), FILTER_DEBOUNCE_DELAY);

    function applyFilters() {
        if (!network || !brandChoices || !typeChoices ) { // Slider optional now
            console.warn("Filter controls or network not ready, skipping filter application.");
            return;
        }
        const yearRangeValue = yearSliderInstance ? yearSliderInstance.get(true) : [minYear, maxYear]; // Get value if slider exists

        const filterCriteria = {
            searchTerm: searchInput ? searchInput.value.toLowerCase().trim() : "",
            brands: brandChoices.getValue(true) || [],
            types: typeChoices.getValue(true) || [],
            yearRange: yearRangeValue
        };
        console.log("Applying Filters:", filterCriteria);
        performNodeFiltering(filterCriteria);
    } // end applyFilters

    function performNodeFiltering(criteria) {
        if (!allNodesDataSet || !allEdgesDataSet) return;
        console.time("NodeFiltering");
        const updatesNodes = []; const updatesEdges = [];
        let visibleModelCount = 0;
        const visibleBrandIds = new Set();

        // --- Determine Model Visibility ---
        allNodesDataSet.forEach(node => {
            if (node.group === 'models') {
                let isVisible = true;
                if (criteria.searchTerm && !node.label.toLowerCase().includes(criteria.searchTerm)) isVisible = false;
                if (isVisible && criteria.brands.length > 0 && !criteria.brands.includes(node.brand)) isVisible = false;
                if (isVisible && criteria.types.length > 0 && !criteria.types.includes(node.modelType)) isVisible = false;
                if (isVisible && criteria.yearRange && node.startYear) {
                    const modelStart = node.startYear;
                    const modelEnd = node.isCurrent ? maxYear + 1 : (node.endYear || node.startYear);
                    if (modelEnd < criteria.yearRange[0] || modelStart > criteria.yearRange[1]) {
                        isVisible = false;
                    }
                }
                // Only add update if state needs changing
                if (node.hidden === isVisible) updatesNodes.push({ id: node.id, hidden: !isVisible });
                if (isVisible && node.brandId) visibleBrandIds.add(node.brandId);
                if (isVisible) visibleModelCount++;
            }
        });

        // --- Determine Brand and Cluster Visibility ---
        allNodesDataSet.forEach(node => {
           let isVisible = true;
           if (node.group === 'brands') {
               isVisible = criteria.brands.length === 0 ? visibleBrandIds.has(node.id) : criteria.brands.includes(node.label);
               if (!isVisible && criteria.brands.includes(node.label)) isVisible = true; // Force show selected brands
           } else if (node.group === 'clusters') {
               isVisible = true; // Always show clusters
           } else { return; } // Skip models

           if (node.hidden === isVisible) updatesNodes.push({ id: node.id, hidden: !isVisible });
        });

        // --- Determine Edge Visibility ---
        const finalVisibleNodeIds = new Set();
        allNodesDataSet.forEach(node => {
             const pendingUpdate = updatesNodes.find(u => u.id === node.id);
             const isHidden = pendingUpdate ? pendingUpdate.hidden : node.hidden;
             if (!isHidden) finalVisibleNodeIds.add(node.id);
        });

        allEdgesDataSet.forEach(edge => {
            const shouldBeVisible = finalVisibleNodeIds.has(edge.from) && finalVisibleNodeIds.has(edge.to);
            if (edge.hidden === !shouldBeVisible) {
                updatesEdges.push({ id: edge.id, hidden: !shouldBeVisible });
            }
        });

        // --- Apply Updates ---
        try {
            if (updatesNodes.length > 0) allNodesDataSet.update(updatesNodes);
            if (updatesEdges.length > 0) allEdgesDataSet.update(updatesEdges);
        } catch (e) { console.error("Error updating dataset visibility:", e); }

        console.timeEnd("NodeFiltering");
        updateGraphStatusOverlay(visibleModelCount, criteria); // Pass model count only
    } // end performNodeFiltering


    function updateGraphStatusOverlay(visibleModelCount, criteria) {
        const yearRangeValue = yearSliderInstance ? yearSliderInstance.get(true) : [minYear, maxYear];
        const hasActiveFilters = criteria.searchTerm ||
                                (criteria.brands && criteria.brands.length > 0) ||
                                (criteria.types && criteria.types.length > 0) ||
                                (yearRangeValue[0] > minYear || yearRangeValue[1] < maxYear);

        if (graphStatusOverlay) { // Check element exists
            if (visibleModelCount === 0 && hasActiveFilters) {
                graphStatusOverlay.textContent = "No models match the current filters.";
                graphStatusOverlay.style.display = 'block';
            } else {
                graphStatusOverlay.style.display = 'none';
            }
        }
    } // end updateGraphStatusOverlay

    function resetAllFilters() {
        console.log("Resetting all filters...");
        if(searchInput) searchInput.value = '';
        if(clearSearchBtn) clearSearchBtn.style.display = 'none';
        if (brandChoices) brandChoices.removeActiveItemsByValue(brandChoices.getValue(true));
        if (typeChoices) typeChoices.removeActiveItemsByValue(typeChoices.getValue(true));
        if (yearSliderInstance) yearSliderInstance.set([minYear, maxYear]);

        // Apply empty filters immediately by calling applyFilters directly
         applyFilters(); // This will trigger performNodeFiltering with empty criteria

        if (window.innerWidth <= 767 && filterControls) closeFilterSidebar();
    } // end resetAllFilters


    function clearSearch() {
         if(searchInput) searchInput.value = '';
         if(clearSearchBtn) clearSearchBtn.style.display = 'none';
         debouncedApplyFilters(); // Re-apply other filters
         if(searchInput) searchInput.focus();
    } // end clearSearch


    // --- Interaction & Details Panel ---
    async function handleNodeClick(params) {
        const clickedNodeIds = params.nodes;
        if (!clickedNodeIds || clickedNodeIds.length === 0) {
            if (detailsPanel && detailsPanel.classList.contains('visible')) detailsPanel.classList.remove('visible');
            return;
        }
        const clickedNodeId = clickedNodeIds[0];

        if (network && network.isCluster(clickedNodeId)) {
            try {
                network.openCluster(clickedNodeId);
            } catch (e) { console.error("Error opening cluster:", e); }
            return;
        }

        const clickedNodeData = allNodesDataSet.get(clickedNodeId);
        if (!clickedNodeData || clickedNodeData.hidden) return;

        if (clickedNodeData.group === 'models') {
            showDetailsPanelLoading(`${clickedNodeData.brand} ${clickedNodeData.label}`);
            const soundLink = clickedNodeData.soundLink || null;
            try {
                const apiUrl = `/api/cardetails?model=${encodeURIComponent(clickedNodeData.label)}&brand=${encodeURIComponent(clickedNodeData.brand)}`;
                const response = await fetch(apiUrl);
                if (!response.ok) {
                    let errorMsg = `Error ${response.status}`;
                    try { const errorData = await response.json(); errorMsg = errorData.error || errorMsg; } catch (e) {}
                    throw new Error(errorMsg);
                }
                const data = await response.json();
                displayDetails(data.htmlContent, data.imageUrl, data.actualTitle || `${clickedNodeData.brand} ${clickedNodeData.label}`, data.wikiPageUrl, soundLink);
            } catch (error) {
                console.error('Failed to fetch car details:', error);
                displayDetails( `<p style="color: var(--accent-color); font-weight: bold;">Could not load details.</p><p>Reason: ${error.message}</p>`, null, `${clickedNodeData.brand} ${clickedNodeData.label}`, null, soundLink);
            }
        } else if (clickedNodeData.group === 'brands') {
            if(network) {
                try { network.focus(clickedNodeData.id, { scale: 1.5, animation: { duration: 500, easingFunction: 'easeInOutQuad' } }); }
                catch(e) { console.error("Error focusing on brand node:", e); }
            }
            if (detailsPanel && detailsPanel.classList.contains('visible')) detailsPanel.classList.remove('visible');
        } else {
            if (detailsPanel && detailsPanel.classList.contains('visible')) detailsPanel.classList.remove('visible');
        }
    } // end handleNodeClick


    function showDetailsPanelLoading(title = "Loading...") {
         if (!detailsContent || !detailsImage || !imagePlaceholder || !detailsImageContainer || !detailsLoading || !detailsPanel) return;
         detailsContent.innerHTML = '';
         detailsImage.style.display = 'none';
         imagePlaceholder.style.display = 'none';
         detailsImageContainer.style.display = 'none';
         detailsLoading.style.display = 'flex';
         detailsPanel.querySelector('h2').textContent = title;
         detailsPanel.classList.add('visible');
     } // end showDetailsPanelLoading

    // --- displayDetails (Using native DOM methods) ---
     function displayDetails(htmlContent, imageUrl, title, wikiPageUrl, soundLink) {
         if (!detailsLoading || !detailsPanel || !detailsContent || !detailsImageContainer || !detailsImage || !imagePlaceholder) return;

         detailsLoading.style.display = 'none';
         detailsPanel.querySelector('h2').textContent = title || "Details Unavailable";
         detailsContent.innerHTML = ''; // Clear previous content

         // --- Structure Content ---
         const tempDiv = document.createElement('div');
         tempDiv.innerHTML = htmlContent || '<p>No detailed content available for this model.</p>';
         const fragment = document.createDocumentFragment();
         let currentSectionDiv = null;
         let sectionCount = 0;

         const createSection = (sectionTitle) => {
             const sectionWrapper = document.createElement('div');
             const heading = document.createElement('h3');
             heading.textContent = sectionTitle || 'Details';
             sectionWrapper.appendChild(heading);
             const contentDiv = document.createElement('div');
             sectionWrapper.appendChild(contentDiv);
             fragment.appendChild(sectionWrapper);
             sectionCount++;
             return contentDiv;
         };
         currentSectionDiv = createSection("Overview");

         Array.from(tempDiv.childNodes).forEach(node => {
             if (node.nodeType === Node.ELEMENT_NODE) {
                  if (node.tagName === 'H3') {
                      const sectionTitle = node.textContent?.trim();
                      if (sectionTitle) {
                          if (currentSectionDiv.hasChildNodes() || sectionCount > 1) {
                             currentSectionDiv = createSection(sectionTitle);
                          } else if (fragment.firstChild?.firstChild) {
                               fragment.firstChild.firstChild.textContent = sectionTitle;
                          }
                      }
                  } else if (currentSectionDiv) {
                      currentSectionDiv.appendChild(node.cloneNode(true));
                  }
             } else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
                   if (currentSectionDiv) {
                        currentSectionDiv.appendChild(node.cloneNode(true));
                   }
             }
         });
         // Remove empty "Overview" if other sections exist
         if (fragment.firstChild && !fragment.firstChild.lastChild.hasChildNodes() && fragment.childNodes.length > 1) {
              fragment.removeChild(fragment.firstChild);
         }
         detailsContent.appendChild(fragment);

         // --- Add Links ---
         if (soundLink) {
              const soundContainer = document.createElement('div');
              soundContainer.className = 'sound-link-container';
              soundContainer.innerHTML = `<a href="${soundLink}" target="_blank" rel="noopener noreferrer" class="sound-link-button"><i class="fa-solid fa-volume-high"></i> Listen to Engine Sound</a>`;
              detailsContent.appendChild(soundContainer);
         }
         if (wikiPageUrl) {
              const wikiContainer = document.createElement('div');
              wikiContainer.className = 'wiki-link-container';
              wikiContainer.innerHTML = `<a href="${wikiPageUrl}" target="_blank" rel="noopener noreferrer" title="View '${title}' on Wikipedia">View full article on Wikipedia <i class="fa-solid fa-arrow-up-right-from-square fa-xs"></i></a>`;
              detailsContent.appendChild(wikiContainer);
         }

         // --- Handle Image ---
         detailsImageContainer.style.display = 'flex';
          if (imageUrl) {
              detailsImage.src = imageUrl;
              detailsImage.style.display = 'block';
              imagePlaceholder.style.display = 'none';
              detailsImage.onerror = () => {
                   console.warn("Failed to load image:", imageUrl);
                   detailsImage.style.display = 'none';
                   imagePlaceholder.textContent = 'Image loading failed';
                   imagePlaceholder.style.display = 'block';
               };
          } else {
              detailsImage.style.display = 'none';
              imagePlaceholder.textContent = 'No Image Available';
              imagePlaceholder.style.display = 'block';
          }

         detailsPanel.classList.add('visible');
         detailsPanel.scrollTop = 0;
     } // end displayDetails


    // --- UI Helpers ---
    function showLoadingMessage(message, isError = false) {
         if (!loadingIndicator || !networkContainer) return;
         loadingIndicator.innerHTML = `<div class="spinner"><i class="fa-solid ${isError ? 'fa-triangle-exclamation' : 'fa-gear fa-spin'}"></i></div> ${message}`;
         loadingIndicator.style.color = isError ? 'var(--accent-color)' : 'var(--text-secondary)';
         loadingIndicator.style.display = 'flex';
         networkContainer.style.visibility = 'hidden';
    } // end showLoadingMessage

     function toggleFilterSidebar() {
          if (!filterControls || !document.body) return;
          filterControls.classList.toggle('open');
          document.body.classList.toggle('filter-open');
          // Re-add listener if opened on mobile
          if (filterControls.classList.contains('open') && window.innerWidth <= 767) {
              filterControls.addEventListener('click', handleMobileFilterCloseClick, { once: true });
          } else {
               filterControls.removeEventListener('click', handleMobileFilterCloseClick); // Remove if closing or not mobile
          }
      } // end toggleFilterSidebar

      function closeFilterSidebar() {
          if (!filterControls || !document.body) return;
          filterControls.classList.remove('open');
          document.body.classList.remove('filter-open');
          filterControls.removeEventListener('click', handleMobileFilterCloseClick); // Ensure listener removed
      } // end closeFilterSidebar

       // Handler for the mobile filter close button (pseudo-element)
       function handleMobileFilterCloseClick(e) {
          if (!filterControls) return;
           // Check if the click happened on the pseudo-element by checking coordinates
           const rect = filterControls.getBoundingClientRect();
           const closeButtonSize = 50; // Approximate clickable area size in pixels
           const clickX = e.clientX - rect.left;
           const clickY = e.clientY - rect.top;

           // Check if click is within the top-right corner bounds
           if (clickX > rect.width - closeButtonSize && clickY < closeButtonSize) {
               closeFilterSidebar();
           } else {
               // If clicked elsewhere inside, re-add the listener for the *next* click
               filterControls.addEventListener('click', handleMobileFilterCloseClick, { once: true });
           }
       } // end handleMobileFilterCloseClick


    // --- Start Application ---
    initializeApp();

}); // --- End DOMContentLoaded ---