// Navigation System - Live GPS navigation with dynamic path visualization
// Integrates with existing pathfinding and GPS functionality

let isNavigating = false;
let currentDestination = null;
let navigationUpdateInterval = null;
let recalculationThreshold = 15; // IMPROVED: Reduced from 20 to 15 to make recalculation more sensitive
let lastRecalculationTime = 0;
let recalculationCooldown = 2000; // IMPROVED: Reduced from 3000 to 2000 to allow more frequent recalculations

// Start navigation to a destination building
function startNavigation(destinationName) {
    console.log("🧭 Starting navigation to:", destinationName);
    
    // ✅ Make sure we can access the calibration factor from gpsTracker.js
    // If not defined, use a default value
    if (typeof calibrationFactor === 'undefined') {
        console.warn('calibrationFactor not found, using default value of 0.5');
        window.calibrationFactor = 0.5;
    } else {
        console.log('Using calibrationFactor:', calibrationFactor);
    }

    // IMPROVED: First make sure GPS tracking is active
    if (!window.lastPosition) {
        console.warn("GPS not available. Starting GPS tracking...");
        
        // Try to start GPS tracking if the function is available
        if (window.gpsTracker && typeof window.gpsTracker.start === 'function') {
            window.gpsTracker.start();
            
            // Show a notification to the user
            Swal.fire({
                icon: 'info',
                title: 'Starting GPS',
                text: 'Please wait while we get your location...',
                timer: 3000,
                timerProgressBar: true
            });
            
            // Try again after GPS has time to initialize
            setTimeout(() => {
                if (window.lastPosition) {
                    startNavigation(destinationName);
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'GPS Not Available',
                        text: 'Navigation requires your location. Please enable GPS and try again.'
                    });
                }
            }, 3000);
        } else {
            // GPS tracking not available
            Swal.fire({
                icon: 'error',
                title: 'GPS Not Available',
                text: 'Navigation requires GPS tracking which is not available on this device or browser.'
            });
        }
        
        return;
    }
    
    // IMPROVED: Clear any existing paths to avoid conflicts
    if (typeof window.clearPath === 'function') {
        window.clearPath();
    } else {
        // Backup method to clear path
        const GROUP_NAME = 'path-visual';
        if (typeof scene !== 'undefined') {
            const old = scene.getObjectByName(GROUP_NAME);
            if (old) scene.remove(old);
        }
    }
    
    // Set navigation state
    isNavigating = true;
    currentDestination = destinationName;
    
    // Force shrink mode for navigation - CRITICAL for path shrinking to work
    window.isPathShrinkMode = true;
    console.log("🛣️ Enabling path shrink mode:", window.isPathShrinkMode);
    
    // Calculate initial path
    console.log("🔍 Finding path to destination:", destinationName);
    
    // Verify the findPathFromCurrentLocationTo function exists and is accessible
    if (typeof window.findPathFromCurrentLocationTo !== 'function') {
        console.error("❌ findPathFromCurrentLocationTo function not found!");
        
        // Check if it exists locally in this context
        if (typeof findPathFromCurrentLocationTo !== 'function') {
            Swal.fire({
                icon: 'error',
                title: 'Navigation Failed',
                text: 'Navigation system could not find the path calculation function.'
            });
            stopNavigation();
            return;
        }
        
        // Add it to the window object so other modules can access it
        window.findPathFromCurrentLocationTo = findPathFromCurrentLocationTo;
    }
    
    // Call the function to find a path from current location
    const path = window.findPathFromCurrentLocationTo(destinationName);
    
    if (!path) {
        console.error("❌ Path calculation failed");
        Swal.fire({
            icon: 'error',
            title: 'Navigation Failed',
            text: 'Could not find a path to your destination'
        });
        stopNavigation();
        return;
    }
    
    // Ensure path information is accessible globally
    window.fullPath = path;
    
    // IMPROVED: Force immediate visualization
    if (typeof window.visualizePath === 'function') {
        console.log("📊 Visualizing initial path with", path.length, "points");
        window.visualizePath(path);
    }
    
    // Show navigation UI
    showNavigationUI(destinationName);
    
    // Set up regular updates to refresh the path visualization
    if (navigationUpdateInterval) {
        clearInterval(navigationUpdateInterval);
    }
    navigationUpdateInterval = setInterval(updateNavigation, 1000);
    
    // Log navigation start
    console.log(`✅ Navigation started successfully to: ${destinationName}`);
    
    // Return the path for any additional processing
    return path;
}

// Update navigation based on current position
function updateNavigation() {
    if (!isNavigating || !currentDestination) {
        console.log("⚠️ Navigation not active, skipping update");
        return;
    }
    
    if (!window.lastPosition) {
        console.warn("⚠️ No position available for navigation update");
        return;
    }
    
    // PERFORMANCE FIX: Add frame skipping to prevent excessive updates
    // Only update visualization every other frame to reduce load
    const now = Date.now();
    if (!window._lastNavUpdate) window._lastNavUpdate = 0;
    const timeSinceLastUpdate = now - window._lastNavUpdate;
    
    // Skip update if it's been less than 500ms since the last update
    if (timeSinceLastUpdate < 500) {
        return;
    }
    window._lastNavUpdate = now;
    
    // Skip if no path is currently active
    if (!window.fullPath) {
        console.warn("⚠️ No active path found during navigation update");
        
        // Try to recalculate the path
        console.log("🔄 Attempting to recalculate missing path...");
        
        // Get the path finding function
        const findPathFn = window.findPathFromCurrentLocationTo || findPathFromCurrentLocationTo;
        
        if (typeof findPathFn === 'function') {
            const newPath = findPathFn(currentDestination);
            if (newPath) {
                console.log("✅ Successfully recalculated path");
                window.fullPath = newPath;
            } else {
                console.error("❌ Failed to recalculate path");
                return;
            }
        } else {
            console.error("❌ Cannot recalculate path: function not available");
            return;
        }
    }
    
    console.log("🔄 Updating navigation path...");
    
    // Force shrink mode to be active during navigation
    // IMPROVED: Always maintain shrink mode during navigation but now the
    // getShrunkPath function will show the full path ahead
    if (!window.isPathShrinkMode) {
        window.isPathShrinkMode = true;
        console.log("⚠️ Shrink mode was disabled, re-enabling for proper path visibility");
    }
    
    // Get the visualization function
    const visualizePathFn = window.visualizePath || visualizePath;
    
    if (typeof visualizePathFn !== 'function') {
        console.error("❌ Cannot update path: visualizePath function not available");
        return;
    }
    
    // PERFORMANCE FIX: Add a try-catch with timing measurement
    try {
        console.log("📊 Updating path visualization with improved shrink behavior");
        const startTime = performance.now();
        visualizePathFn(window.fullPath);
        const endTime = performance.now();
        const duration = endTime - startTime;
        
        // If visualization takes too long, reduce update frequency
        if (duration > 100) {
            console.warn(`⚠️ Path visualization took ${duration.toFixed(2)}ms - reducing update frequency`);
            // Double the interval between updates for performance
            if (navigationUpdateInterval) {
                clearInterval(navigationUpdateInterval);
                navigationUpdateInterval = setInterval(updateNavigation, 2000);
            }
        }
    } catch (err) {
        console.error("❌ Error updating path visualization:", err);
    }
    
    // Check if we need to recalculate the path
    if (now - lastRecalculationTime > recalculationCooldown) {
        checkForPathRecalculation();
        lastRecalculationTime = now;
    }
    
    // Check if we've reached the destination
    checkForArrival();
    
    // PERFORMANCE FIX: Implement a failsafe timer to ensure navigation can be stopped even if updates freeze
    if (!window._navigationFailsafeTimer) {
        window._navigationFailsafeTimer = setTimeout(() => {
            // Reset this timer so it can be set again
            window._navigationFailsafeTimer = null;
            
            // Check if navigation controls are still responsive
            const stopBtn = document.getElementById('stopNavigationBtn');
            if (stopBtn && !stopBtn.getAttribute('data-event-attached')) {
                console.warn("⚠️ Navigation stop button event appears to be missing, reattaching");
                stopBtn.addEventListener('click', stopNavigation);
                stopBtn.setAttribute('data-event-attached', 'true');
            }
        }, 5000);
    }
}

// Check if we need to recalculate the path (if we're off the path)
function checkForPathRecalculation() {
    if (!isNavigating || !window.fullPathPoints || window.fullPathPoints.length === 0) {
        console.warn("⚠️ Cannot check for recalculation: missing path points");
        return;
    }
    
    console.log("🧮 Checking if path recalculation is needed...");
    
    // Check if geoToWorld is available
    if (typeof window.geoToWorld !== 'function') {
        console.error("geoToWorld function is not available, cannot recalculate path");
        return;
    }
    
    // Get current position
    let currentPos;
    if (window.lastPosition.coords) {
        const worldPos = window.geoToWorld(window.lastPosition.coords.latitude, window.lastPosition.coords.longitude);
        currentPos = new THREE.Vector3(worldPos.x, 0, worldPos.z);
    } else {
        // Handle simulation position if that's what we have
        currentPos = new THREE.Vector3(window.lastPosition.x, 0, window.lastPosition.z);
    }
    
    // Find closest point on path
    let closestPointDistance = Infinity;
    let closestIndex = 0;
    
    for (let i = 0; i < window.fullPathPoints.length; i++) {
        const distance = currentPos.distanceTo(window.fullPathPoints[i]);
        if (distance < closestPointDistance) {
            closestPointDistance = distance;
            closestIndex = i;
        }
    }
    
    console.log(`📏 Distance to closest path point: ${closestPointDistance.toFixed(2)} units`);
    console.log(`📍 Closest point index: ${closestIndex} of ${window.fullPathPoints.length} points`);
    
    // IMPROVED: Also check if we're close to the end of the path but haven't triggered arrival yet
    const isNearEnd = closestIndex > window.fullPathPoints.length * 0.9;
    
    // Check if we're too far from the path
    if (closestPointDistance > recalculationThreshold || isNearEnd) {
        // IMPROVED: Add explanation of why we're recalculating
        if (closestPointDistance > recalculationThreshold) {
            console.log(`🔄 Off path by ${closestPointDistance.toFixed(2)} units. Recalculating...`);
        } else {
            console.log(`🔄 Near end of path (point ${closestIndex} of ${window.fullPathPoints.length}). Recalculating for accuracy...`);
        }
        
        // Recalculate path
        const newPath = findPathFromCurrentLocationTo(currentDestination);
        if (newPath) {
            console.log("✅ Path recalculated successfully");
            
            // The visualizePath function will be called by findPathFromCurrentLocationTo
            // and fullPath will be updated
        } else {
            console.warn("❌ Failed to recalculate path");
        }
    } else {
        console.log("✅ On path, no recalculation needed");
    }
}

// Check if we've reached the destination
function checkForArrival() {
    if (!isNavigating || !currentDestination || !window.lastPosition || !window.fullPathPoints) return;
    
    // Get destination building
    const destBuilding = findBuildingByName(currentDestination);
    if (!destBuilding) return;
    
    // Get destination position
    const destPos = new THREE.Vector3();
    new THREE.Box3().setFromObject(destBuilding).getCenter(destPos);
    
    // Check if geoToWorld is available
    if (typeof window.geoToWorld !== 'function') {
        console.error("geoToWorld function is not available, cannot check arrival");
        return;
    }
    
    // Get current position
    let currentPos;
    if (window.lastPosition.coords) {
        const worldPos = window.geoToWorld(window.lastPosition.coords.latitude, window.lastPosition.coords.longitude);
        currentPos = new THREE.Vector3(worldPos.x, 0, worldPos.z);
    } else {
        currentPos = new THREE.Vector3(window.lastPosition.x, 0, window.lastPosition.z);
    }
    
    // Check distance to destination
    const distanceToDest = currentPos.distanceTo(destPos);
    
    // IMPROVED: Log the distance to destination for debugging
    console.log(`📏 Distance to destination: ${distanceToDest.toFixed(2)} units`);
    
    // If we're close enough, we've arrived
    if (distanceToDest < 20) { // Adjust this threshold as needed
        Swal.fire({
            icon: 'success',
            title: 'You Have Arrived!',
            text: `You have reached ${currentDestination}`
        });
        
        stopNavigation();
    }
}

// Stop navigation
function stopNavigation() {
    console.log("🛑 Stopping navigation");
    
    // PERFORMANCE FIX: Clear all timers first thing to prevent further updates
    if (navigationUpdateInterval) {
        clearInterval(navigationUpdateInterval);
        navigationUpdateInterval = null;
    }
    
    // Clear failsafe timer if exists
    if (window._navigationFailsafeTimer) {
        clearTimeout(window._navigationFailsafeTimer);
        window._navigationFailsafeTimer = null;
    }
    
    // Reset navigation state
    isNavigating = false;
    currentDestination = null;
    
    // Reset path display
    window.isPathShrinkMode = false;
    
    // PERFORMANCE FIX: Forcefully remove path visualization to ensure cleanup
    try {
        // Clear path visualization directly
        const GROUP_NAME = 'path-visual';
        if (typeof scene !== 'undefined') {
            const old = scene.getObjectByName(GROUP_NAME);
            if (old) {
                scene.remove(old);
                console.log("✅ Path visual removed from scene");
            }
        }
        
        // Reset path variables
        if (window.fullPath) window.fullPath = null;
        if (window.fullPathPoints) window.fullPathPoints = [];
    } catch (err) {
        console.error("Error clearing path:", err);
    }
    
    // Hide navigation UI
    hideNavigationUI();
    
    console.log("✅ Navigation stopped successfully");
}

// Show navigation UI
function showNavigationUI(destinationName) {
    // Check if navigation UI already exists
    let navUI = document.getElementById('navigationUI');
    
    if (!navUI) {
        // Create navigation UI
        navUI = document.createElement('div');
        navUI.id = 'navigationUI';
        navUI.style.position = 'fixed';
        navUI.style.bottom = '70px';
        navUI.style.left = '50%';
        navUI.style.transform = 'translateX(-50%)';
        navUI.style.backgroundColor = 'rgba(255, 255, 255, 0.95)';
        navUI.style.padding = '15px 25px';
        navUI.style.borderRadius = '15px';
        navUI.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.15)';
        navUI.style.display = 'flex';
        navUI.style.flexDirection = 'column';
        navUI.style.alignItems = 'center';
        navUI.style.zIndex = '1000';
        navUI.style.minWidth = '250px';
        
        document.body.appendChild(navUI);
    }
    
    // Update content
    navUI.innerHTML = `
        <div style="font-size: 16px; font-weight: bold; margin-bottom: 10px;">
            <i class="fa fa-location-arrow" style="color: #5d84c2; margin-right: 8px;"></i>
            Navigating to ${destinationName}
        </div>
        <div id="navigationDistance" style="font-size: 14px; margin-bottom: 15px;">
            Calculating distance...
        </div>
        <button id="stopNavigationBtn" style="background-color: #f44336; color: white; border: none; 
                padding: 8px 16px; border-radius: 20px; cursor: pointer;">
            <i class="fa fa-times" style="margin-right: 5px;"></i> Stop Navigation
        </button>
    `;
    
    // PERFORMANCE FIX: Ensure the event listener is correctly attached and only once
    const stopButton = document.getElementById('stopNavigationBtn');
    if (stopButton) {
        // Remove any existing event listeners (though this doesn't really work for anonymous functions)
        stopButton.replaceWith(stopButton.cloneNode(true));
        
        // Get the new button reference after replacing
        const newStopButton = document.getElementById('stopNavigationBtn');
        
        // Add event listener with a named function reference
        newStopButton.addEventListener('click', function onStopClick(e) {
            console.log("🖱️ Stop navigation button clicked");
            // Call stopNavigation directly
            stopNavigation();
            // Remove this event listener to prevent memory leaks
            newStopButton.removeEventListener('click', onStopClick);
        });
        
        // Mark that we've attached the event
        newStopButton.setAttribute('data-event-attached', 'true');
        
        console.log("✅ Added stop button event listener");
    } else {
        console.error("❌ Could not find stop navigation button");
    }
    
    // Add a backup stop button to ensure navigation can always be stopped
    const backupStopButton = document.createElement('button');
    backupStopButton.id = 'emergencyStopNav';
    backupStopButton.innerHTML = '🛑 Emergency Stop';
    backupStopButton.style.position = 'fixed';
    backupStopButton.style.top = '10px';
    backupStopButton.style.right = '10px';
    backupStopButton.style.zIndex = '2000';
    backupStopButton.style.background = '#ff0000';
    backupStopButton.style.color = 'white';
    backupStopButton.style.padding = '10px';
    backupStopButton.style.borderRadius = '5px';
    backupStopButton.style.display = 'none'; // Hidden by default
    
    backupStopButton.addEventListener('click', function() {
        console.log("🆘 Emergency stop button clicked");
        stopNavigation();
        backupStopButton.remove();
    });
    
    document.body.appendChild(backupStopButton);
    
    // Show the emergency button after a delay if navigation is still active
    setTimeout(() => {
        if (isNavigating) {
            backupStopButton.style.display = 'block';
        }
    }, 10000);
    
    // Start updating distance
    updateNavigationDistance();
}

// Update the distance display in the navigation UI
function updateNavigationDistance() {
    if (!isNavigating || !currentDestination) return;
    
    const distanceElement = document.getElementById('navigationDistance');
    if (!distanceElement) return;
    
    // Get destination building
    const destBuilding = findBuildingByName(currentDestination);
    if (!destBuilding) return;
    
    // Get destination position
    const destPos = new THREE.Vector3();
    new THREE.Box3().setFromObject(destBuilding).getCenter(destPos);
    
    // Get current position
    if (!window.lastPosition) {
        distanceElement.textContent = "Waiting for GPS...";
        return;
    }
    
    // Check if geoToWorld is available
    if (typeof window.geoToWorld !== 'function') {
        console.error("geoToWorld function is not available, cannot update distance");
        distanceElement.textContent = "Navigation error";
        return;
    }
    
    let currentPos;
    if (window.lastPosition.coords) {
        const worldPos = window.geoToWorld(window.lastPosition.coords.latitude, window.lastPosition.coords.longitude);
        currentPos = new THREE.Vector3(worldPos.x, 0, worldPos.z);
    } else {
        currentPos = new THREE.Vector3(window.lastPosition.x, 0, window.lastPosition.z);
    }
    
    // Calculate direct distance
    const distance = currentPos.distanceTo(destPos);
    
    // Use calibrationFactor if defined, otherwise use a default
    const calFactor = (typeof calibrationFactor !== 'undefined') ? calibrationFactor : 0.5;
    
    // Update display (this is an approximation - in meters)
    const distanceMeters = Math.round(distance / calFactor);
    distanceElement.innerHTML = `
        <i class="fa fa-map-marker" style="color: #5d84c2; margin-right: 8px;"></i>
        ${distanceMeters > 1000 ? 
            (distanceMeters / 1000).toFixed(1) + ' km' : 
            distanceMeters + ' m'} remaining
    `;
    
    // Continue updating
    if (isNavigating) {
        setTimeout(updateNavigationDistance, 2000);
    }
}

// Hide navigation UI
function hideNavigationUI() {
    const navUI = document.getElementById('navigationUI');
    if (navUI) {
        navUI.remove();
    }
}

// Function to hook into the existing UI
function hookIntoPathfindingUI() {
    // Override the findPathButton click handler to add navigation functionality
    const findPathButton = document.getElementById('findPathButton');
    
    if (findPathButton) {
        // Store the original onclick handler
        const originalOnClick = findPathButton.onclick;
        
        // Replace with our new handler
        findPathButton.onclick = function(e) {
            // First call the original handler to compute the path
            if (originalOnClick) {
                originalOnClick.call(this, e);
            }
            
            // Then start navigation if we're using current location
            const startInput = document.getElementById('startBuildingInput');
            const endInput = document.getElementById('endBuildingInput');
            
            if (!startInput || !endInput) {
                console.error("❌ Could not find path input elements");
                return;
            }
            
            const startDisplay = startInput.value;
            const endDisplay = endInput.value;
            
            if (!startDisplay || !endDisplay) {
                console.warn("⚠️ Missing start or end location");
                return;
            }
            
            console.log(`🔍 Find path from "${startDisplay}" to "${endDisplay}"`);
            
            // Make sure displayNameToInternalName is defined and has the Current Location mapping
            if (!window.displayNameToInternalName) {
                console.error("⚠️ Error: displayNameToInternalName is not defined");
                window.displayNameToInternalName = {};
                // Add the mapping for Current Location
                window.displayNameToInternalName["Current Location"] = "_CURRENT_LOCATION_";
            } else if (window.displayNameToInternalName["Current Location"] === undefined) {
                // Ensure Current Location mapping exists
                window.displayNameToInternalName["Current Location"] = "_CURRENT_LOCATION_";
                console.log("Added missing 'Current Location' mapping");
            }
            
            // Handle "Current Location" specially - case insensitive check with trimming
            let startBuilding;
            // FIXED: Improved detection of "Current Location" option with case-insensitive comparison
            if (startDisplay.trim().toLowerCase() === "current location") {
                console.log("✅ Starting from Current Location detected");
                startBuilding = "_CURRENT_LOCATION_";
                
                // FIXED: Ensure GPS is started when using current location
                if (!window.lastPosition && window.gpsTracker && typeof window.gpsTracker.start === 'function') {
                    console.log("Starting GPS for Current Location navigation");
                    window.gpsTracker.start();
                }
            } else {
                console.log(`Starting from building: ${startDisplay}`);
                startBuilding = window.displayNameToInternalName[startDisplay] || startDisplay;
            }
            
            // Safely get endBuilding, defaulting to the display name if mapping doesn't exist
            const endBuilding = window.displayNameToInternalName[endDisplay] || endDisplay;
            
            // If starting from current location, start navigation
            if (startBuilding === "_CURRENT_LOCATION_") {
                console.log("🧭 Starting navigation from Current Location");
                
                // FIXED: Check if GPS is available and start it if needed
                if (!window.lastPosition) {
                    console.log("GPS position not available yet, starting GPS...");
                    
                    if (window.gpsTracker && typeof window.gpsTracker.start === 'function') {
                        window.gpsTracker.start();
                        
                        // Show waiting dialog
                        Swal.fire({
                            icon: 'info',
                            title: 'Starting GPS',
                            text: 'Please wait while we get your location...',
                            timer: 4000,
                            timerProgressBar: true,
                            showConfirmButton: false
                        }).then(() => {
                            // After waiting, check if we have position and start navigation
                            if (window.lastPosition) {
                                console.log("GPS position acquired, starting navigation");
                                startNavigation(endBuilding);
                            } else {
                                Swal.fire({
                                    icon: 'error',
                                    title: 'GPS Not Available',
                                    text: 'Could not get your current location. Please try again when GPS is available.',
                                    confirmButtonText: 'Try Again',
                                }).then((result) => {
                                    if (result.isConfirmed) {
                                        // Try again when user clicks "Try Again"
                                        findPathButton.click();
                                    }
                                });
                            }
                        });
                    } else {
                        Swal.fire({
                            icon: 'error',
                            title: 'GPS Not Available',
                            text: 'Navigation from current location requires GPS, which is not available.'
                        });
                    }
                } else {
                    // We already have GPS position, start navigation immediately
                    startNavigation(endBuilding);
                }
            } else {
                // Show option to start navigation
                Swal.fire({
                    title: 'Start Navigation?',
                    text: 'Would you like to use your current GPS position to navigate to this destination?',
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: 'Yes, Navigate',
                    cancelButtonText: 'No, Just Show Path'
                }).then((result) => {
                    if (result.isConfirmed) {
                        // Safely get endBuilding, defaulting to the display name if mapping doesn't exist
                        const endBuilding = window.displayNameToInternalName[endDisplay] || endDisplay;
                        
                        // FIXED: Ensure GPS is active before starting navigation
                        if (!window.gpsTracker || !window.lastPosition) {
                            console.log("Starting GPS tracking for navigation...");
                            
                            // Make sure we have access to gpsTracker functions
                            if (window.gpsTracker && typeof window.gpsTracker.start === 'function') {
                                window.gpsTracker.start();
                            } else {
                                // If gpsTracker not properly initialized, show error
                                Swal.fire({
                                    icon: 'error',
                                    title: 'GPS Not Available',
                                    text: 'Navigation requires GPS tracking but it could not be initialized.'
                                });
                                return;
                            }
                            
                            // Show loading dialog while waiting for GPS
                            Swal.fire({
                                icon: 'info',
                                title: 'Starting GPS',
                                text: 'Please wait while we get your location...',
                                timer: 4000,
                                timerProgressBar: true
                            }).then(() => {
                                // After GPS has had time to initialize
                                if (window.lastPosition) {
                                    console.log("GPS position acquired, starting navigation");
                                    
                                    // FIXED: Use a more thorough path clearing approach
                                    // Clear the current path using both local and global functions
                                    if (typeof window.clearPath === 'function') {
                                        console.log("Using window.clearPath");
                                        window.clearPath();
                                    }
                                    
                                    // Start navigation with current position
                                    startNavigation(endBuilding);
                                } else {
                                    Swal.fire({
                                        icon: 'error',
                                        title: 'GPS Position Not Available',
                                        text: 'Could not get your current location. Please try again when GPS is available.'
                                    });
                                }
                            });
                        } else {
                            console.log("GPS already active, starting navigation");
                            
                            // FIXED: Ensure we use both clearPath functions to avoid conflicts
                            // Only one will actually work depending on scope, but this covers both cases
                            if (typeof window.clearPath === 'function') {
                                window.clearPath();
                            } else {
                                // Clear the path group from the scene directly if function not available
                                const GROUP_NAME = 'path-visual';
                                if (scene) {
                                    const old = scene.getObjectByName(GROUP_NAME);
                                    if (old) scene.remove(old);
                                }
                            }
                            
                            // Start navigation with current position
                            startNavigation(endBuilding);
                        }
                    }
                });
            }
        };
    }
    
    // Also hook into the clear path button
    const clearPathButton = document.getElementById('clearPathButton');
    if (clearPathButton) {
        const originalClearOnClick = clearPathButton.onclick;
        
        clearPathButton.onclick = function(e) {
            // Stop navigation if active
            if (isNavigating) {
                stopNavigation();
            }
            
            // Call original handler
            if (originalClearOnClick) {
                originalClearOnClick.call(this, e);
            }
        };
    }
}

// Initialize the navigation system
function initNavigationSystem() {
    console.log("🚀 Initializing Navigation System...");
    
    // Check global variables immediately
    console.log("🔍 DIAGNOSTIC: Global variable check on init");
    console.log("  → isPathShrinkMode:", window.isPathShrinkMode);
    console.log("  → fullPath exists:", window.fullPath !== null && window.fullPath !== undefined);
    console.log("  → fullPathPoints exists:", Array.isArray(window.fullPathPoints));
    console.log("  → navigationSystem exists:", typeof window.navigationSystem);
    
    // Hook into the existing UI
    hookIntoPathfindingUI();
    
    // Set up a listener for GPS updates to refresh navigation
    // This is more efficient than polling on a timer
    document.addEventListener('gps_position_updated', function(e) {
        console.log("📡 GPS update received in navigation system");
        console.log("🔍 DIAGNOSTIC: Variable state during GPS update");
        console.log("  → isPathShrinkMode:", window.isPathShrinkMode);
        console.log("  → fullPath exists:", window.fullPath !== null && window.fullPath !== undefined);
        console.log("  → fullPathPoints length:", Array.isArray(window.fullPathPoints) ? window.fullPathPoints.length : 'N/A');
        console.log("  → isNavigating:", isNavigating);
        
        // Test direct variable access
        if (typeof isPathShrinkMode !== 'undefined') {
            console.log("  → Local isPathShrinkMode:", isPathShrinkMode, "matches global:", isPathShrinkMode === window.isPathShrinkMode);
        }
        
        if (isNavigating && window.fullPath) {
            // Ensure shrink mode is enabled during navigation
            window.isPathShrinkMode = true;
            console.log("  → Force enabled shrink mode for navigation");
            
            // Update path visualization with current position
            try {
                console.log("  → Calling visualizePath from event handler");
                visualizePath(window.fullPath);
                console.log("  → visualizePath completed successfully");
            } catch (err) {
                console.error("  → ERROR in visualizePath:", err);
            }
            
            // Check if we're at the destination
            checkForArrival();
        } else {
            console.log("  → Not visualizing path: isNavigating=", isNavigating, "fullPath exists=", !!window.fullPath);
        }
    });
    
    console.log("✅ Navigation System initialized");
    
    // Test visualization after a short delay
    setTimeout(function() {
        console.log("🔍 DIAGNOSTIC: Delayed variable check");
        console.log("  → isPathShrinkMode:", window.isPathShrinkMode);
        console.log("  → fullPath exists:", window.fullPath !== null && window.fullPath !== undefined);
        console.log("  → fullPathPoints length:", Array.isArray(window.fullPathPoints) ? window.fullPathPoints.length : 'N/A');
        console.log("  → Available functions:", 
            typeof visualizePath === 'function' ? 'visualizePath' : '',
            typeof getShrunkPath === 'function' ? 'getShrunkPath' : '');
    }, 2000);
}

// Initialize when the page loads
window.addEventListener('load', initNavigationSystem);

// Make functions available globally
window.navigationSystem = {
    start: startNavigation,
    stop: stopNavigation,
    isActive: () => isNavigating
}; 