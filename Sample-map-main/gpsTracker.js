// ✅ Streamlined GPS tracker focused on live tracking

// 🌍 Scaling factor (adjust this to match your 3D model scale)
const WORLD_SCALE = 1;  // Starting scale factor

let gpsMarker;
let gpsAccuracyRing;
let gpsPath;
let gpsPathPoints = [];
let watchId = null;
let lastPosition = null; // Stores the complete position object
// Make lastPosition globally accessible
window.lastPosition = lastPosition;
let calibrationFactor = 0.6163;
// Make calibrationFactor globally accessible
window.calibrationFactor = calibrationFactor;

// Reference point for calibration
const REFERENCE_LATITUDE = 8.5644027;
const REFERENCE_LONGITUDE = 76.8879752;
const LIBRARY_WORLD_X =  115.0550;
const LIBRARY_WORLD_Z = -80.5000;

const GPS_CONFIG = {
    markerSize: 5,
    markerColor: 0xff0000,  // changed to red
    markerHeight: 0, // Set to ground level
    accuracyColor: 0x5d84c2,
    accuracyOpacity: 0.2,
    pathColor: 0x5d84c2,
    pathWidth: 3,
    updateInterval: 1000,
    maxPathPoints: 500,
    smoothingFactor: 0.3,
    useHighAccuracy: true,
    showAccuracyRing: true,
    showPath: true,
    xrayMode: true,  // Enable X-ray visibility by default
    // PERFORMANCE FIX: Add throttling configuration
    minUpdateInterval: 1000  // Minimum time between GPS updates in milliseconds
};

// PERFORMANCE FIX: Add a GPS update throttling
let lastGpsUpdateTime = 0;

/**
 * Direct GPS to World transformation using calibration point
 */
function geoToWorld(latitude, longitude) {
  const R = 6371000; // Earth radius in meters
  const lat1 = REFERENCE_LATITUDE * Math.PI / 180;
  const lat2 = latitude * Math.PI / 180;
  const dLat = (latitude - REFERENCE_LATITUDE) * Math.PI / 180;
  const dLon = (longitude - REFERENCE_LONGITUDE) * Math.PI / 180;

  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = Math.atan2(y, x);

  const scaledDistance = distance * calibrationFactor;
  const worldX = LIBRARY_WORLD_X + (scaledDistance * Math.sin(bearing));
  const worldZ = LIBRARY_WORLD_Z - (scaledDistance * Math.cos(bearing));

  console.log(`🌐 Advanced geoToWorld: Lat=${latitude}, Lon=${longitude} ➔ X=${worldX.toFixed(2)}, Z=${worldZ.toFixed(2)}`);
  return { x: worldX, z: worldZ };
}

function setupGPSMarker() {
    // ✅ Create the pinpoint marker (a cone with a small sphere on top)
    const markerGroup = new THREE.Group();
    markerGroup.name = 'gpsMarker';

    // Cone for the "pin"
    const coneGeometry = new THREE.ConeGeometry(3, 10, 16);  // radius, height, segments
    const coneMaterial = new THREE.MeshBasicMaterial({ 
        color: GPS_CONFIG.markerColor,
        depthTest: false,  // Make visible through buildings
        transparent: true,
        opacity: 0.9
    });
    const cone = new THREE.Mesh(coneGeometry, coneMaterial);
    cone.position.y = 5;  // Lower position to be at ground level
    cone.renderOrder = 999; // High render order to ensure it's drawn on top

    // Optional: add a small sphere on top to look like a pin head
    const sphereGeometry = new THREE.SphereGeometry(2, 16, 16);
    const sphereMaterial = new THREE.MeshBasicMaterial({ 
        color: GPS_CONFIG.markerColor,
        depthTest: false,  // Make visible through buildings
        transparent: true,
        opacity: 0.9
    });
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere.position.y = 10;  // Lower position to match the new cone height
    sphere.renderOrder = 999; // High render order to ensure it's drawn on top

    // Add a pulsing ring effect
    const pulseGeometry = new THREE.RingGeometry(4, 5, 32);
    const pulseMaterial = new THREE.MeshBasicMaterial({
        color: GPS_CONFIG.markerColor,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthTest: false  // Make visible through buildings
    });
    const pulseRing = new THREE.Mesh(pulseGeometry, pulseMaterial);
    pulseRing.rotation.x = -Math.PI / 2; // Flat on the ground
    pulseRing.position.y = 0.1;  // Just above the ground
    pulseRing.renderOrder = 999; // High render order to ensure it's drawn on top
    
    // Animation for the pulse
    const animatePulse = () => {
        if (!pulseRing) return;
        pulseRing.scale.x = 1 + 0.3 * Math.sin(Date.now() * 0.003);
        pulseRing.scale.z = 1 + 0.3 * Math.sin(Date.now() * 0.003);
        requestAnimationFrame(animatePulse);
    };
    animatePulse();

    // Add all to marker group
    markerGroup.add(cone);
    markerGroup.add(sphere);
    markerGroup.add(pulseRing);

    markerGroup.visible = false;
    scene.add(markerGroup);
    gpsMarker = markerGroup;

    // ✅ Create accuracy circle
    const ringGeometry = new THREE.CircleGeometry(1, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
        color: GPS_CONFIG.accuracyColor,
        transparent: true,
        opacity: GPS_CONFIG.accuracyOpacity,
        side: THREE.DoubleSide,
        depthTest: false  // Make visible through buildings
    });
    gpsAccuracyRing = new THREE.Mesh(ringGeometry, ringMaterial);
    gpsAccuracyRing.rotation.x = -Math.PI / 2; // Flat on the ground
    gpsAccuracyRing.position.y = 0.1;  // Just above the ground
    gpsAccuracyRing.visible = false;
    gpsAccuracyRing.renderOrder = 998; // High render order but below the marker
    scene.add(gpsAccuracyRing);

    // ✅ Create path trail
    const pathMaterial = new THREE.LineBasicMaterial({
        color: GPS_CONFIG.pathColor,
        linewidth: GPS_CONFIG.pathWidth,
        transparent: true,
        opacity: 0.7,
        depthTest: false  // Make visible through buildings
    });
    const pathGeometry = new THREE.BufferGeometry();
    gpsPath = new THREE.Line(pathGeometry, pathMaterial);
    gpsPath.visible = false;
    gpsPath.renderOrder = 997; // High render order but below the accuracy ring
    scene.add(gpsPath);

    addGPSControls();
    console.log("✅ GPS marker system initialized (Pinpoint style with X-ray visibility)");
}

function updateGPSMarker(position) {
  if (!position || !position.coords) return;

  // PERFORMANCE FIX: Throttle GPS updates
  const now = Date.now();
  if (now - lastGpsUpdateTime < GPS_CONFIG.minUpdateInterval) {
    // Skip this update if it's too soon after the last one
    return;
  }
  lastGpsUpdateTime = now;

  console.log("🔍 DIAGNOSTIC: GPS marker update");
  
  // Store the complete position object for later use
  lastPosition = position;
  
  // Check if window.lastPosition was previously defined
  const wasUndefined = window.lastPosition === undefined || window.lastPosition === null;
  
  // Update global variable
  window.lastPosition = position;
  
  console.log(`  → Updated lastPosition: ${wasUndefined ? 'was undefined before' : 'was previously defined'}`);
  console.log(`  → Coordinates: Lat=${position.coords.latitude.toFixed(6)}, Lon=${position.coords.longitude.toFixed(6)}`);
  
  // Dispatch a custom event for the navigation system
  try {
    const positionEvent = new CustomEvent('gps_position_updated', {
      detail: {
        position: position,
        timestamp: Date.now()
      }
    });
    document.dispatchEvent(positionEvent);
    console.log("  → GPS update event dispatched");
  } catch (err) {
    console.error("  → Error dispatching GPS event:", err);
  }
  
  // PERFORMANCE FIX: Reduce logging for better performance
  const isNavigationActive = window.navigationSystem && window.navigationSystem.isActive();
  if (isNavigationActive) {
    console.log("  → Navigation active, updating path");
  }
  
  // Also update path visualization directly if in navigation mode
  if (isNavigationActive && window.fullPath) {
    try {
      window.isPathShrinkMode = true; // Ensure shrink mode is active
      visualizePath(window.fullPath);
    } catch (err) {
      console.error("  → Error updating path visualization:", err);
    }
  }

  const coords = position.coords;

  const worldPos = geoToWorld(coords.latitude, coords.longitude);

  console.log('✅ GPS UPDATE: Lat:', coords.latitude, 'Lon:', coords.longitude);
  console.log('➡️ Converted to 3D world position:', worldPos.x, worldPos.z);

  gpsMarker.position.x = worldPos.x;
  gpsMarker.position.z = worldPos.z;
  gpsMarker.visible = true;

  // Update accuracy ring
  if (GPS_CONFIG.showAccuracyRing && gpsAccuracyRing) {
      const accuracyRadius = coords.accuracy * calibrationFactor * 0.1;  // Scale as needed
      gpsAccuracyRing.scale.set(accuracyRadius, accuracyRadius, 1);
      gpsAccuracyRing.position.x = worldPos.x;
      gpsAccuracyRing.position.z = worldPos.z;
      gpsAccuracyRing.visible = true;
  }

  // Update path if enabled
  if (GPS_CONFIG.showPath) {
      updateGPSPath(worldPos);
  }

  // Update info display
  updateGPSInfoDisplay(position);
}

// Camera follow functionality has been removed

// Update path with new position
function updateGPSPath(worldPos) {
    // Add point to path
    gpsPathPoints.push(new THREE.Vector3(worldPos.x, 1, worldPos.z));
    
    // Limit number of points in path
    if (gpsPathPoints.length > GPS_CONFIG.maxPathPoints) {
        gpsPathPoints.shift();
    }
    
    // Update path geometry
    if (gpsPath && gpsPathPoints.length > 1) {
        const pathGeometry = new THREE.BufferGeometry().setFromPoints(gpsPathPoints);
        gpsPath.geometry.dispose();
        gpsPath.geometry = pathGeometry;
        gpsPath.visible = true;
    }
}

// Start GPS tracking
function startGPSTracking() {
    if (navigator.geolocation) {
        // Show starting message
        showGPSStatus("Starting GPS...");
        
        // Clear any existing watch
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
        }
        
        // Options for geolocation
        const options = {
            enableHighAccuracy: GPS_CONFIG.useHighAccuracy,
            timeout: 20000,
            maximumAge: 0
        };
        
        // PERFORMANCE FIX: Reset last update time before starting new tracking
        lastGpsUpdateTime = 0;
        
        // Start watching position
        watchId = navigator.geolocation.watchPosition(
            // Success callback
            (position) => {
                showGPSStatus("GPS Active", true);
                updateGPSMarker(position);
            },
            // Error callback
            (error) => {
                console.error("GPS Error:", error);
                let errorMsg = "GPS Error";
                
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        errorMsg = "GPS permission denied";
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMsg = "GPS position unavailable";
                        break;
                    case error.TIMEOUT:
                        errorMsg = "GPS request timeout";
                        break;
                }
                
                showGPSStatus(errorMsg, false);
            },
            options
        );
        
        console.log("GPS tracking started with watchId:", watchId);
    } else {
        showGPSStatus("Geolocation not supported", false);
        console.error("Geolocation is not supported by this browser");
    }
}

function stopGPSTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        if (gpsMarker) gpsMarker.visible = false;
        if (gpsAccuracyRing) gpsAccuracyRing.visible = false;
        showGPSStatus("GPS Stopped", false);
        console.log("GPS tracking stopped");
    }
}

function showGPSStatus(message, isActive = null) {
    let status = document.getElementById('gpsStatus');
    if (!status) {
        status = document.createElement('div');
        status.id = 'gpsStatus';
        status.style.position = 'absolute';
        status.style.bottom = '10px';
        status.style.left = '10px';
        status.style.padding = '8px 12px';
        status.style.borderRadius = '20px';
        status.style.fontSize = '14px';
        status.style.fontWeight = 'bold';
        status.style.zIndex = '1000';
        status.style.boxShadow = '0 4px 16px rgba(93, 132, 194, 0.15)';
        document.body.appendChild(status);
    }
    status.textContent = message;
    if (isActive === true) {
        status.style.backgroundColor = 'rgba(235, 255, 240, 0.95)';
        status.style.color = '#38a169';
        status.style.borderLeft = '4px solid #38a169';
    } else if (isActive === false) {
        status.style.backgroundColor = 'rgba(255, 235, 235, 0.95)';
        status.style.color = '#e53e3e';
        status.style.borderLeft = '4px solid #e53e3e';
    } else {
        status.style.backgroundColor = 'rgba(235, 245, 255, 0.95)';
        status.style.color = '#5d84c2';
        status.style.borderLeft = '4px solid #5d84c2';
    }
}

function updateGPSInfoDisplay(position) {
    // Function is now a no-op since we removed the GPS info display
    return;
}

function addGPSControls() {
    // Check if we already have the navigation panel, and if not, create it
    const checkNavigationPanel = () => {
        const existingPanel = document.getElementById('navigationPanel');
        if (!existingPanel) return false;
        return existingPanel;
    };

    const navPanel = checkNavigationPanel();
    if (!navPanel) return;

    // Add GPS toggle controls to the navigation panel
    const gpsControlsDiv = document.createElement('div');
    gpsControlsDiv.className = 'gps-controls';
    gpsControlsDiv.style.marginTop = '15px';
    gpsControlsDiv.style.borderTop = '1px solid #ddd';
    gpsControlsDiv.style.paddingTop = '10px';

    gpsControlsDiv.innerHTML = `
        <h3 style="margin-top: 0; margin-bottom: 10px; font-size: 16px;">GPS Options</h3>
        <div style="display: flex; flex-direction: column; gap: 8px;">
            <label style="display: flex; align-items: center; cursor: pointer;">
                <input type="checkbox" id="gpsToggle" ${watchId ? 'checked' : ''} style="margin-right: 8px;">
                GPS Tracking
            </label>
            <!-- Camera follow toggle removed -->
            <label style="display: flex; align-items: center; cursor: pointer;">
                <input type="checkbox" id="gpsXrayToggle" ${GPS_CONFIG.xrayMode ? 'checked' : ''} style="margin-right: 8px;">
                X-ray Visibility
            </label>
            <!-- View mode selection removed -->
        </div>
        <div id="gpsStatus" style="margin-top: 10px; font-size: 12px; color: #666;"></div>
    `;

    navPanel.appendChild(gpsControlsDiv);

    // Add event listeners
    document.getElementById('gpsToggle').addEventListener('change', function(e) {
        if (this.checked) {
            startGPSTracking();
        } else {
            stopGPSTracking();
        }
    });

        // Camera follow toggle has been removed

    document.getElementById('gpsXrayToggle').addEventListener('change', function(e) {
        GPS_CONFIG.xrayMode = this.checked;
        
        // Update all marker materials with new depthTest setting
        if (gpsMarker) {
            gpsMarker.traverse((child) => {
                if (child.isMesh && child.material) {
                    child.material.depthTest = !GPS_CONFIG.xrayMode;
                    child.material.needsUpdate = true;
                }
            });
        }
        
        if (gpsAccuracyRing) {
            gpsAccuracyRing.material.depthTest = !GPS_CONFIG.xrayMode;
            gpsAccuracyRing.material.needsUpdate = true;
        }
        
        if (gpsPath) {
            gpsPath.material.depthTest = !GPS_CONFIG.xrayMode;
            gpsPath.material.needsUpdate = true;
        }
        
        showGPSStatus(`X-ray visibility ${GPS_CONFIG.xrayMode ? 'enabled' : 'disabled'}`);
    });

    // View mode selection has been removed

    // Add the status div for GPS messages
    showGPSStatus('GPS controls initialized');
}

// Initialize the GPS system
function initGPSSystem() {
    console.log("🌐 Initializing enhanced GPS system...");
    
    // Setup the actual GPS marker geometry
    setupGPSMarker();
    
    // Set initial visibility based on configuration
    if (gpsMarker) {
        // Apply x-ray mode to all marker parts
        gpsMarker.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material.depthTest = !GPS_CONFIG.xrayMode;
            }
        });
    }
    
    if (gpsAccuracyRing) {
        gpsAccuracyRing.material.depthTest = !GPS_CONFIG.xrayMode;
    }
    
    if (gpsPath) {
        gpsPath.material.depthTest = !GPS_CONFIG.xrayMode;
    }
    
    console.log(`🌐 GPS system initialized with x-ray mode ${GPS_CONFIG.xrayMode ? 'enabled' : 'disabled'}`);
    
    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
        if (watchId) {
            navigator.geolocation.clearWatch(watchId);
        }
    });
}

// Call this function when the page loads
window.addEventListener('load', initGPSSystem);

// Export functions for external use if needed
window.gpsTracker = {
    start: startGPSTracking,
    stop: stopGPSTracking
};

// Export geoToWorld function globally
window.geoToWorld = geoToWorld;