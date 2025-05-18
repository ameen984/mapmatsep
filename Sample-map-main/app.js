let scene, camera, renderer, model, controls;
let raycaster, mouse;
let selectedBuilding = null;
let isTopView = true;
let buildingData = new Map();
let mapBounds = null;
let mapCenter = new THREE.Vector3();
let mapSize = new THREE.Vector3();
let inertiaEnabled = true;
let inertia = { x: 0, y: 0, z: 0 };
let lastMousePosition = { x: 0, y: 0 };
let isMouseDown = false;
let damping = 0.95;
let roadGraph = null;
let roadPoints = [];
// record of how you've recentered/scaled the GLTF (if you still do that)
let modelTransform = {
  scale:     1,
  translate: new THREE.Vector3(0, 0, 0)
};
let graphCalibration = {
    scale: new THREE.Vector3(1, 1, 1),   // Additional scaling factor
    translate: new THREE.Vector3(0, 5, 0), // Additional translation
    rotate: new THREE.Euler(0, 0, 0)     // Additional rotation in radians
  };

// Facility types (customize as needed)
const facilityTypes = [
    'Drinking Water', 'Toilet', 'Canteen', 'Stationary Store',
    'Waiting sheds', 'Rest room', 'Hostel', 'Sports', 'Leisure areas'
];
window.facilityTypes = facilityTypes;

// Global mapping from display_name to internal name
let displayNameToInternalName = {};
window.displayNameToInternalName = displayNameToInternalName;

// Ensure Current Location is always mapped
window.displayNameToInternalName["Current Location"] = "_CURRENT_LOCATION_";

////////////////////////////////////////////////////////////////////////////////
// ROAD‐GRAPH LOADER (Insert here)
////////////////////////////////////////////////////////////////////////////////
// ─────────────────────────────────────────────────────────────────
// 1) ROAD‐GRAPH LOADER
// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// 1) ROAD‐GRAPH LOADER
// ─────────────────────────────────────────────────────────────────
async function loadRoadGraph() {
    const resp = await fetch('road_graph.json');
    const data = await resp.json();
  
    // convert legacy "nodes" → "points"
    if (data.nodes && !data.points) {
      data.points = data.nodes.map(n => ({
        id: n.id,
        position: { x: n.position[0], y: n.position[1], z: n.position[2] }
      }));
    }
  
    // normalize any array of edges → connections
    data.connections = data.connections || data.edges || data.links;
  
    // fallback: chain each point to its next neighbor
    if (!data.connections) {
      data.connections = data.points.slice(0, -1).map((p, i) => {
        const q = data.points[i + 1];
        const dx = q.position.x - p.position.x;
        const dy = q.position.y - p.position.y;
        const dz = q.position.z - p.position.z;
        return { from: p.id, to: q.id, cost: Math.hypot(dx, dy, dz) };
      });
    }
  
    return data;
  }
  function transformGraphPoint(point) {
    // Start with original point position
    const pos = new THREE.Vector3(
      point.position.x,
      point.position.y,
      point.position.z
    );
    
    // Apply rotation (if any)
    pos.applyEuler(graphCalibration.rotate);
    
    // Apply calibration scale factor (component-wise)
    pos.x *= graphCalibration.scale.x;
    pos.y *= graphCalibration.scale.y;
    pos.z *= graphCalibration.scale.z;
    
    // Apply model scale
    pos.multiplyScalar(modelTransform.scale);
    
    // Apply model translation
    pos.add(modelTransform.translate);
    
    // Apply calibration translation
    pos.add(graphCalibration.translate);
    
    return pos;
  }
  
  
// ─────────────────────────────────────────────────────────────────
// 2) DEBUG: VISUALIZE ROAD GRAPH UNDER MODEL TRANSFORM
// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// 2) DEBUG: VISUALIZE ROAD GRAPH WITH MODEL TRANSFORM
// ─────────────────────────────────────────────────────────────────
function visualizeRoadGraph(graph) {
    // Remove previous visuals
    const old = scene.getObjectByName('road-graph-visuals');
    if (old) scene.remove(old);
  
    const group = new THREE.Group();
    group.name = 'road-graph-visuals';
    
    // Draw nodes
    const nodeGeo = new THREE.SphereGeometry(1.2, 8, 8);
    const nodeMat = new THREE.MeshBasicMaterial({ color: 0x0000ff });
    
    // Create a lookup map for faster access during edge creation
    const nodePositions = new Map();
    
    for (const p of graph.points) {
      // Apply full transformation
      const world = transformGraphPoint(p);
      
      // Store transformed position for edge creation
      nodePositions.set(p.id, world.clone());
      
      const mesh = new THREE.Mesh(nodeGeo, nodeMat);
      mesh.position.copy(world);
      group.add(mesh);
    }
  
    // Draw edges
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x888888 });
    const positions = [];
    
    for (const c of graph.connections) {
      // Use pre-calculated positions from the nodePositions map
      const wa = nodePositions.get(c.from);
      const wb = nodePositions.get(c.to);
      
      if (wa && wb) {
        positions.push(wa.x, wa.y, wa.z, wb.x, wb.y, wb.z);
      }
    }
    
    const edgeGeo = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    );
    
    group.add(new THREE.LineSegments(edgeGeo, edgeMat));
    scene.add(group);
    
    console.log(`Visualized road graph with ${graph.points.length} nodes and ${graph.connections.length} connections`);
    console.log('Current graph calibration:', graphCalibration);
  }
  function addCalibrationControls() {
    // Add a simple GUI panel for adjusting road graph calibration
    // Only add this if you have dat.gui included in your project
    if (window.dat && window.dat.GUI) {
      const gui = new dat.GUI({ name: 'Graph Calibration' });
      
      // Scale controls
      const scaleFolder = gui.addFolder('Scale');
      scaleFolder.add(graphCalibration.scale, 'x', 0.1, 10).name('X Scale').onChange(() => visualizeRoadGraph(roadGraph));
      scaleFolder.add(graphCalibration.scale, 'y', 0.1, 10).name('Y Scale').onChange(() => visualizeRoadGraph(roadGraph));
      scaleFolder.add(graphCalibration.scale, 'z', 0.1, 10).name('Z Scale').onChange(() => visualizeRoadGraph(roadGraph));
      scaleFolder.open();
      
      // Translation controls
      const translateFolder = gui.addFolder('Translation');
      translateFolder.add(graphCalibration.translate, 'x', -100, 100).name('X Shift').onChange(() => visualizeRoadGraph(roadGraph));
      translateFolder.add(graphCalibration.translate, 'y', -100, 100).name('Y Shift').onChange(() => visualizeRoadGraph(roadGraph));
      translateFolder.add(graphCalibration.translate, 'z', -100, 100).name('Z Shift').onChange(() => visualizeRoadGraph(roadGraph));
      translateFolder.open();
      
      // Rotation controls (in degrees for easier understanding)
      const rotationFolder = gui.addFolder('Rotation (degrees)');
      
      // We need to convert between degrees (GUI) and radians (THREE.js)
      const rotationProxy = {
        x: graphCalibration.rotate.x * 180/Math.PI,
        y: graphCalibration.rotate.y * 180/Math.PI,
        z: graphCalibration.rotate.z * 180/Math.PI
      };
      
      rotationFolder.add(rotationProxy, 'x', -180, 180).name('X Rotation').onChange(value => {
        graphCalibration.rotate.x = value * Math.PI/180;
        visualizeRoadGraph(roadGraph);
      });
      
      rotationFolder.add(rotationProxy, 'y', -180, 180).name('Y Rotation').onChange(value => {
        graphCalibration.rotate.y = value * Math.PI/180;
        visualizeRoadGraph(roadGraph);
      });
      
      rotationFolder.add(rotationProxy, 'z', -180, 180).name('Z Rotation').onChange(value => {
        graphCalibration.rotate.z = value * Math.PI/180;
        visualizeRoadGraph(roadGraph);
      });
      
      rotationFolder.open();
      
      // Add a button to log current calibration to console
      gui.add({ logCalibration: function() {
        console.log('Current calibration:', JSON.stringify(graphCalibration, null, 2));
      }}, 'logCalibration').name('Log Calibration');
    } else {
      console.warn('dat.GUI not found. Calibration controls not added.');
    }
  }
  function setupKeyboardCalibration() {
    window.addEventListener('keydown', (event) => {
      // Only run when holding the Alt key
      if (!event.altKey) return;
      
      // Define movement step sizes
      const translateStep = event.shiftKey ? 5 : 1;
      const scaleStep = event.shiftKey ? 0.1 : 0.01;
      const rotateStep = event.shiftKey ? 5 : 1;
      
      let updated = false;
      
      // Translation with WASD + QE
      if (event.key === 'a') { 
        graphCalibration.translate.x -= translateStep; 
        updated = true; 
      }
      if (event.key === 'd') { 
        graphCalibration.translate.x += translateStep; 
        updated = true; 
      }
      if (event.key === 'w') { 
        graphCalibration.translate.z -= translateStep; 
        updated = true; 
      }
      if (event.key === 's') { 
        graphCalibration.translate.z += translateStep; 
        updated = true; 
      }
      if (event.key === 'q') { 
        graphCalibration.translate.y -= translateStep; 
        updated = true; 
      }
      if (event.key === 'e') { 
        graphCalibration.translate.y += translateStep; 
        updated = true; 
      }
      
      // Scale with IJK (X, Y, Z)
      if (event.key === 'i') {
        graphCalibration.scale.x += scaleStep;
        updated = true;
      }
      if (event.key === 'k') {
        graphCalibration.scale.x -= scaleStep;
        updated = true;
      }
      if (event.key === 'o') {
        graphCalibration.scale.y += scaleStep;
        updated = true;
      }
      if (event.key === 'l') {
        graphCalibration.scale.y -= scaleStep;
        updated = true;
      }
      if (event.key === 'p') {
        graphCalibration.scale.z += scaleStep;
        updated = true;
      }
      if (event.key === ';') {
        graphCalibration.scale.z -= scaleStep;
        updated = true;
      }
      
      // Rotation with arrow keys + PageUp/PageDown
      if (event.key === 'ArrowLeft') {
        graphCalibration.rotate.y -= rotateStep * Math.PI/180;
        updated = true;
      }
      if (event.key === 'ArrowRight') {
        graphCalibration.rotate.y += rotateStep * Math.PI/180;
        updated = true;
      }
      if (event.key === 'ArrowUp') {
        graphCalibration.rotate.x -= rotateStep * Math.PI/180;
        updated = true;
      }
      if (event.key === 'ArrowDown') {
        graphCalibration.rotate.x += rotateStep * Math.PI/180;
        updated = true;
      }
      if (event.key === 'PageUp') {
        graphCalibration.rotate.z += rotateStep * Math.PI/180;
        updated = true;
      }
      if (event.key === 'PageDown') {
        graphCalibration.rotate.z -= rotateStep * Math.PI/180;
        updated = true;
      }
      
      // Print current settings with 'c'
      if (event.key === 'c') {
        console.log('Current calibration:', {
          scale: {
            x: graphCalibration.scale.x.toFixed(3),
            y: graphCalibration.scale.y.toFixed(3),
            z: graphCalibration.scale.z.toFixed(3)
          },
          translate: {
            x: graphCalibration.translate.x.toFixed(1),
            y: graphCalibration.translate.y.toFixed(1),
            z: graphCalibration.translate.z.toFixed(1)
          },
          rotate: {
            x: (graphCalibration.rotate.x * 180/Math.PI).toFixed(1) + '°',
            y: (graphCalibration.rotate.y * 180/Math.PI).toFixed(1) + '°',
            z: (graphCalibration.rotate.z * 180/Math.PI).toFixed(1) + '°'
          }
        });
      }
      
      // Reset with 'r'
      if (event.key === 'r') {
        graphCalibration = {
          scale: new THREE.Vector3(1, 1, 1),
          translate: new THREE.Vector3(0, 5, 0),
          rotate: new THREE.Euler(0, 0, 0)
        };
        updated = true;
        console.log('Calibration reset to defaults');
      }
      
      if (updated) {
        visualizeRoadGraph(roadGraph);
        event.preventDefault();
      }
    });
    
    // Add a help overlay for keyboard shortcuts
    const helpDiv = document.createElement('div');
    helpDiv.style.position = 'fixed';
    helpDiv.style.bottom = '10px';
    helpDiv.style.right = '10px';
    helpDiv.style.background = 'rgba(0,0,0,0.7)';
    helpDiv.style.color = 'white';
    helpDiv.style.padding = '10px';
    helpDiv.style.borderRadius = '5px';
    helpDiv.style.fontSize = '12px';
    helpDiv.style.fontFamily = 'monospace';
    helpDiv.style.display = 'none';
    helpDiv.style.zIndex = '1000';
    
    helpDiv.innerHTML = `
      <h3>Graph Alignment Keyboard Controls</h3>
      <p>Hold ALT + key to adjust</p>
      <p>Hold SHIFT for larger increments</p>
      <ul>
        <li>W/A/S/D - Move graph (X/Z)</li>
        <li>Q/E - Move graph up/down (Y)</li>
        <li>I/K - Scale X axis</li>
        <li>O/L - Scale Y axis</li>
        <li>P/; - Scale Z axis</li>
        <li>Arrows - Rotate X/Y</li>
        <li>Page Up/Down - Rotate Z</li>
        <li>C - Print current settings</li>
        <li>R - Reset to defaults</li>
        <li>H - Toggle this help</li>
      </ul>
    `;
    
    document.body.appendChild(helpDiv);
    
    // Toggle help with 'h' key
    window.addEventListener('keydown', (event) => {
      if (event.key === 'h') {
        helpDiv.style.display = helpDiv.style.display === 'none' ? 'block' : 'none';
      }
    });
    
    console.log('Keyboard calibration controls enabled. Press H for help.');
  }
  
  // Add a comparison mode to help with alignment
  function toggleComparisonMode() {
    const graphVisuals = scene.getObjectByName('road-graph-visuals');
    
    if (!graphVisuals) {
      console.warn('No graph visualization found');
      return;
    }
    
    // Toggle visibility of different elements to help with alignment
    graphVisuals.visible = !graphVisuals.visible;
    
    console.log(
      graphVisuals.visible ? 
      'Graph visualization enabled' : 
      'Graph visualization disabled'
    );
  }
  
  // ─────────────────────────────────────────────────────────────────
  // Function to save alignment to localStorage
  // ─────────────────────────────────────────────────────────────────
  function saveGraphAlignment() {
    const calibration = {
      scale: {
        x: graphCalibration.scale.x,
        y: graphCalibration.scale.y,
        z: graphCalibration.scale.z
      },
      translate: {
        x: graphCalibration.translate.x,
        y: graphCalibration.translate.y,
        z: graphCalibration.translate.z
      },
      rotate: {
        x: graphCalibration.rotate.x,
        y: graphCalibration.rotate.y,
        z: graphCalibration.rotate.z
      }
    };
    
    localStorage.setItem('graphCalibration', JSON.stringify(calibration));
    console.log('Graph calibration saved:', calibration);
  }
  
  // ─────────────────────────────────────────────────────────────────
  // Function to load alignment from localStorage
  // ─────────────────────────────────────────────────────────────────
  function loadGraphAlignment() {
    const saved = localStorage.getItem('graphCalibration');
    if (saved) {
      try {
        const calibration = JSON.parse(saved);
        
        graphCalibration.scale.set(
          calibration.scale.x, 
          calibration.scale.y, 
          calibration.scale.z
        );
        
        graphCalibration.translate.set(
          calibration.translate.x, 
          calibration.translate.y, 
          calibration.translate.z
        );
        
        graphCalibration.rotate.set(
          calibration.rotate.x, 
          calibration.rotate.y, 
          calibration.rotate.z
        );
        
        console.log('Graph calibration loaded:', calibration);
        
        if (roadGraph) {
          visualizeRoadGraph(roadGraph);
        }
        
        return true;
      } catch (e) {
        console.error('Failed to load graph calibration:', e);
      }
    }
    
    return false;
  }
  
  // ─────────────────────────────────────────────────────────────────
  // Initialize calibration tools
  // ─────────────────────────────────────────────────────────────────
  function initGraphCalibrationTools() {
    // Try to load saved calibration
    graphCalibration = {
        scale: new THREE.Vector3(1.0, 1.0, 1.0),             // Final scale X, Y, Z
        translate: new THREE.Vector3(3.0, 2, 7.0),         // Final translate X, Y, Z
        rotate: new THREE.Euler(-Math.PI / 2, 0, 0)          // Final rotate X, Y, Z in radians (-90° = -π/2)
    };
    
    // Set up keyboard controls
    setupKeyboardCalibration();
    
    // Add UI controls and buttons
    addComparisonModeButton();
  }
  
  // Add a button for comparison mode
  function addComparisonModeButton() {
    const controlsDiv = document.createElement('div');
    controlsDiv.style.position = 'absolute';
    controlsDiv.style.top = '20px';
    controlsDiv.style.right = '10px';
    controlsDiv.style.zIndex = '100';
    controlsDiv.style.display = 'flex';
    controlsDiv.style.flexDirection = 'row';
    controlsDiv.style.gap = '8px';
    
    const toggleButton = document.createElement('button');
    toggleButton.textContent = 'Toggle Graph';
    toggleButton.className = 'graph-control-button';
    toggleButton.style.marginTop = null;
    toggleButton.addEventListener('click', toggleComparisonMode);
    
    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save Alignment';
    saveButton.className = 'graph-control-button';
    saveButton.style.marginBottom = null;
    saveButton.addEventListener('click', saveGraphAlignment);
    
    controlsDiv.appendChild(toggleButton);
    controlsDiv.appendChild(saveButton);
    document.body.appendChild(controlsDiv);
  }
  
// Initialize building data
function initializeBuildingData() {
    const defaultInfo = {
        description: 'Building information not available',
        details: 'Additional details pending'
    };

    return async function(buildingName) {
        if (buildingData.has(buildingName)) {
            return buildingData.get(buildingName);
        }

        try {
            // You can replace this with actual API call to fetch building data
            const { data: buildingData, error: buildingError } = await supabase
                .from('buildings')
                .select('*')
                .eq('name', buildingName)
                .single();

            if (buildingError) {
                console.error('Error fetching building:', buildingError);
                return null;
            }

            if (!buildingData) {
                console.log('No building found with name:', buildingName);
                return null;
            }

            console.log('Found building data:', buildingData);

            // Then fetch the departments for this building
            const { data: departmentsData, error: departmentsError } = await supabase
                .from('departments')
                .select('*')
                .eq('building_id', buildingData.id);

            if (departmentsError) {
                console.error('Error fetching departments:', departmentsError);
            }

            console.log('Querying departments for building_id:', buildingData.id);
            console.log('Departments query result:', departmentsData);

            // Combine the data
            const combinedData = {
                ...buildingData,
                departments: departmentsData || []
            };

            console.log('Combined building data:', combinedData);
            buildingData.set(buildingName, combinedData);
            return combinedData;
        } catch (error) {
            console.error('Error in fetchBuildingDetailsByName:', error);
            return null;
        }
    };
}

const getBuildingInfo = initializeBuildingData();

function createGround() {
    const groundGeometry = new THREE.PlaneGeometry(2000, 2000);
    const groundMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xe8eef7,
        side: THREE.DoubleSide,
        roughness: 0.8,
        metalness: 0.2
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1; // Explicitly set ground to y=0
    ground.receiveShadow = true;
    ground.userData.isGround = true; // Mark as ground
    ground.userData.isInteractiveBuilding = false; // Explicitly mark as non-interactive
    scene.add(ground);
}

function setupLighting() {
    // Clear any existing lights first
    scene.children.forEach(child => {
        if (child.isLight) scene.remove(child);
    });
    
    // Base ambient light - softer than before
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);

    // Main directional light (sun)
    const sunLight = new THREE.DirectionalLight(0xfffaf0, 1.0);
    sunLight.position.set(100, 200, 100);
    sunLight.castShadow = true;
    
    // Improve shadow quality
    sunLight.shadow.mapSize.width = 4096;
    sunLight.shadow.mapSize.height = 4096;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 1000;
    
    // Adjust shadow camera frustum
    const shadowSize = 500;
    sunLight.shadow.camera.left = -shadowSize;
    sunLight.shadow.camera.right = shadowSize;
    sunLight.shadow.camera.top = shadowSize;
    sunLight.shadow.camera.bottom = -shadowSize;
    
    sunLight.shadow.radius = 2;
    scene.add(sunLight);

    // Secondary fill light
    const fillLight = new THREE.DirectionalLight(0xc2d1e8, 0.4);
    fillLight.position.set(-100, 50, -100);
    scene.add(fillLight);

    // Hemisphere light
    const hemisphereLight = new THREE.HemisphereLight(0x90c0ff, 0x556b2f, 0.4);
    scene.add(hemisphereLight);
}

function setupEnvironment() {
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    
    const color1 = new THREE.Color(0x88ccff);
    const color2 = new THREE.Color(0xffffff);
    
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    context.fillStyle = color1.getStyle();
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = color2.getStyle();
    context.fillRect(1, 0, 1, 1);
    
    const envTexture = new THREE.CanvasTexture(canvas);
    envTexture.needsUpdate = true;
    
    const envMap = pmremGenerator.fromEquirectangular(envTexture).texture;
    scene.environment = envMap;
    
    pmremGenerator.dispose();
}

// ─────────────────────────────────────────────────────────────────
// APP INITIALIZATION
// ─────────────────────────────────────────────────────────────────
// Make sure you have at the top of the file:
// let roadGraph = null;
// let roadPoints = [];

// ─────────────────────────────────────────────────────────────────
// 3) INIT (async) — loads graph, sets up A*, then kicks off model load
// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// 3) INIT (async) — loads graph, sets up A*, then kicks off model load
// ─────────────────────────────────────────────────────────────────
async function init() {
    const container = document.getElementById('container');
    const loadingOverlay = document.getElementById('loadingOverlay');
  
    // raycaster & mouse
    raycaster = new THREE.Raycaster();
    mouse     = new THREE.Vector2();
  
    // scene & camera
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf2f4f8);
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 10000);
    camera.position.set(0, 500, 0);
    camera.lookAt(0, 0, 0);
  
    // renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
  
    // environment, lights, ground
    setupEnvironment();
    setupLighting();
    createGround();
  
    // controls & events
    setupControls();
    setupEventListeners();
  
    // ───────────────────────────────────────────────────────────────
    // load the road graph before the model
    roadGraph  = await loadRoadGraph();
    pathfinder = new AStarPathfinder(roadGraph);
    roadPoints = roadGraph.points.map(p => ({
      id:       p.id,
      position: new THREE.Vector3(p.position.x, p.position.y, p.position.z)
    }));
    console.log('Road graph loaded, A* ready');
    // ───────────────────────────────────────────────────────────────
    initGraphCalibrationTools();
    // now load the 3D model
    loadModel();
  
    // kick off render loop
    animate();
  }
  
  async function fetchAndAttachBuildingData() {
    const promises = [];
    model.traverse((obj) => {
        if (obj.userData.isInteractiveBuilding && obj.name) {
            const p = fetchBuildingDetailsByName(obj.name).then(buildingData => {
                if (buildingData) {
                    obj.userData.buildingData = buildingData;
                }
            });
            promises.push(p);
        }
    });
    await Promise.all(promises);
  }
  


  
// ─────────────────────────────────────────────────────────────────
// 4) LOAD MODEL — applies transforms, then visualizes graph under it
// ─────────────────────────────────────────────────────────────────
function loadModel() {
  const loader = new THREE.GLTFLoader();
  const loadingOverlay = document.getElementById('loadingOverlay');

  loader.load(
    'model.glb',
    async function (gltf) {  // <-- async to allow await
      if (model) scene.remove(model);
      model = gltf.scene;

      let hasLights = false;
      model.traverse(node => {
        if (node.isLight) {
          hasLights = true;
          if (node.castShadow !== undefined) {
            node.castShadow = true;
            node.shadow.mapSize.width = 2048;
            node.shadow.mapSize.height = 2048;
          }
        }
      });
      if (!hasLights) setupLighting();

      const bbox   = new THREE.Box3().setFromObject(model);
      const size   = bbox.getSize(new THREE.Vector3());
      const center = bbox.getCenter(new THREE.Vector3());
      const minY   = bbox.min.y;

      const maxDim    = Math.max(size.x, size.z);
      const targetPct = 0.8 * Math.min(window.innerWidth, window.innerHeight);
      const scale     = targetPct / maxDim;

      model.scale.setScalar(scale);
      model.position.set(
        -center.x * scale,
        -minY   * scale,
        -center.z * scale
      );

      modelTransform.scale     = scale;
      modelTransform.translate = model.position.clone();

      setupModelMaterials();
      scene.add(model);

      await fetchAndAttachBuildingData();  // ✅ attach Supabase data
      populateBuildingDatalist();

      if (roadGraph) visualizeRoadGraph(roadGraph);

      setupInitialView();
      calculateMapBoundaries();
      loadingOverlay.style.display = 'none';
    },
    xhr => {
      console.log(`Loading: ${(xhr.loaded / xhr.total * 100).toFixed(1)}%`);
    },
    error => {
      console.error('Error loading model:', error);
      loadingOverlay.style.display = 'none';
      Swal.fire({
        icon: 'error',
        title: 'Load Error',
        text: 'Failed to load model. Refresh?'
      });
    }
  );
}
// ✅ Add this before you call it anywhere
async function fetchBuildingDetailsByName(buildingName) {
    try {
        console.log('Fetching building details for:', buildingName);
        
        // First fetch the building details
        const { data: buildingData, error: buildingError } = await supabase
            .from('buildings')
            .select('*')
            .eq('name', buildingName)
            .single();

        if (buildingError) {
            console.error('Error fetching building:', buildingError);
            return null;
        }

        if (!buildingData) {
            console.log('No building found with name:', buildingName);
            return null;
        }

        console.log('Found building data:', buildingData);

        // Then fetch the departments for this building
        const { data: departmentsData, error: departmentsError } = await supabase
            .from('departments')
            .select('*')
            .eq('building_id', buildingData.id);

        if (departmentsError) {
            console.error('Error fetching departments:', departmentsError);
        }

        console.log('Querying departments for building_id:', buildingData.id);
        console.log('Departments query result:', departmentsData);

        // Combine the data
        const combinedData = {
            ...buildingData,
            departments: departmentsData || []
        };

        console.log('Combined building data:', combinedData);
        return combinedData;
    } catch (error) {
        console.error('Error in fetchBuildingDetailsByName:', error);
        return null;
    }
}

// Example usage
async function onBuildingClick(buildingName) {
  const data = await fetchBuildingDetailsByName(buildingName);
  showSidebar(data);
}

  


// Populate building selection dropdowns
function populateBuildingSelects() {
    if (!model) return;
    
    const startSelect = document.getElementById('startBuildingSelect');
    const endSelect = document.getElementById('endBuildingSelect');
    
    // Clear previous options except the first one
    while (startSelect.options.length > 1) {
        startSelect.remove(1);
    }
    
    while (endSelect.options.length > 1) {
        endSelect.remove(1);
    }
    
    // Find all interactive buildings
    const buildings = [];
    model.traverse((object) => {
        if (object.userData && object.userData.isInteractiveBuilding) {
            buildings.push({
                name: object.name,
                info: object.userData.buildingInfo
            });
        }
    });
    
    // Sort buildings alphabetically
    buildings.sort((a, b) => a.name.localeCompare(b.name));
    
    // Add options to selects
    buildings.forEach(building => {
        const startOption = document.createElement('option');
        startOption.value = building.name;
        startOption.textContent = building.name;
        startSelect.appendChild(startOption);
        
        const endOption = document.createElement('option');
        endOption.value = building.name;
        endOption.textContent = building.name;
        endSelect.appendChild(endOption);
    });
}

async function setupModelMaterials() {
    model.traverse(async function(child) {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            
            // Create a unique material instance for each mesh
            if (child.material) {
                // Clone the material for each building to make it independent
                child.material = child.material.clone();
                
                // Save original material properties
                child.userData.originalMaterial = child.material.clone();
                child.userData.originalColor = child.material.color ? 
                                              child.material.color.clone() : 
                                              new THREE.Color(0xcccccc);
                
                // Enhance material properties if needed
                if (child.material.isMeshStandardMaterial) {
                    child.material.envMapIntensity = 1.0;
                    if (child.material.roughness === 1) child.material.roughness = 0.8;
                } else {
                    // Create a unique phong material for each building
                    child.material = new THREE.MeshPhongMaterial({
                        color: child.userData.originalColor,
                        shininess: 30,
                        specular: 0x444444
                    });
                }
            }
            
            // Consider all meshes with names as interactive buildings
            if (child.name && child.name.trim() !== '') {
                child.userData.isInteractiveBuilding = true;
                child.userData.buildingInfo = await getBuildingInfo(child.name);
            }
        }
    });
}

// Calculate map boundaries based on the model
function calculateMapBoundaries() {
    if (!model) return;
    
    mapBounds = new THREE.Box3().setFromObject(model);
    mapCenter = mapBounds.getCenter(new THREE.Vector3());
    mapSize = mapBounds.getSize(new THREE.Vector3());
    
    // Set up some padding to keep camera from going too far
    const padding = Math.max(mapSize.x, mapSize.z) * 0.1;
    mapBounds.min.x -= padding;
    mapBounds.min.z -= padding;
    mapBounds.max.x += padding;
    mapBounds.max.z += padding;
}

function setupControls() {
    // Orbit (mouse) controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.15; // Increased from 0.1 for smoother deceleration
    controls.screenSpacePanning = true;
    controls.minDistance = 50;
    controls.maxDistance = 500;
    controls.maxPolarAngle = Math.PI / 2.2; // Slightly adjusted to prevent going below ground
    controls.minPolarAngle = Math.PI / 8; // Lowered to allow more vertical viewing angles
    controls.rotateSpeed = 0.5; // Adjusted for better control
    controls.zoomSpeed = 1.0; // Increased for more responsive zoom
    controls.panSpeed = 0.8; // Increased for smoother panning
    
    // Update mouse button mapping for more intuitive control
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE, // Changed from PAN to ROTATE for more traditional 3D controls
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN // Changed from ROTATE to PAN
    };
    
    controls.enableKeys = false;
    controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN
    };
    
    // Add inertia properties for smoother movement
    controls.enableZoom = true;
    controls.enableRotate = true;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0.5;
  
    // UI buttons (click)
    document.getElementById('tiltButton')
      .addEventListener('click', toggleTiltView);
    document.getElementById('zoomIn')
      .addEventListener('click', () => zoomView(0.9)); // More gentle zoom
    document.getElementById('zoomOut')
      .addEventListener('click', () => zoomView(1.1)); // More gentle zoom
  
    // --- TOUCH CONTROLS VIA HAMMER.JS ---
    const hammer = new Hammer(renderer.domElement);
    hammer.get('pan').set({ direction: Hammer.DIRECTION_ALL, threshold: 5 });
    hammer.get('pinch').set({ enable: true });
    hammer.get('tap').set({ taps: 1 });
    hammer.get('doubletap').set({ taps: 2, threshold: 8, posThreshold: 20 });
    
    let lastPanPoint = { x: 0, y: 0 };
    let isPanning = false;
  
    // Pan → translate camera target
    hammer.on('panstart', (e) => {
      isPanning = true;
      lastPanPoint = { x: e.center.x, y: e.center.y };
    });
    
    hammer.on('panmove', (e) => {
      if (!isPanning) return;
      
      // Calculate delta from last point instead of initial point for smoother control
      const deltaX = -(e.center.x - lastPanPoint.x) * 0.7; // Adjusted sensitivity
      const deltaY = (e.center.y - lastPanPoint.y) * 0.7;
      
      // Get camera forward and right vectors for more intuitive movement
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      forward.y = 0;
      forward.normalize();
      
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      right.y = 0;
      right.normalize();
      
      // Move based on camera orientation
      const moveVector = new THREE.Vector3()
        .add(right.multiplyScalar(deltaX * 0.1))
        .add(forward.multiplyScalar(deltaY * 0.1));
      
      controls.target.add(moveVector);
      camera.position.add(moveVector);
      
      lastPanPoint = { x: e.center.x, y: e.center.y };
    });
    
    hammer.on('panend', () => {
      isPanning = false;
    });
  
    // Pinch → zoom
    let initialDist = null;
    hammer.on('pinchstart', (e) => { 
      initialDist = e.scale; 
      controls.enableZoom = false; // Temporarily disable OrbitControls zoom
    });
    
    hammer.on('pinchmove', (e) => {
      if (initialDist === null) return;
      const zoomFactor = e.scale / initialDist;
      
      // Use logarithmic scaling for smoother zoom
      const scaleFactor = zoomFactor > 1 ? 
        1 + Math.log10(zoomFactor) * 0.5 : 
        1 - Math.log10(1/zoomFactor) * 0.5;
      
      zoomView(1/scaleFactor);
      initialDist = e.scale;
    });
    
    hammer.on('pinchend', () => {
      initialDist = null;
      controls.enableZoom = true; // Re-enable OrbitControls zoom
    });
  
    // Single tap → select building
    hammer.on('tap', (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.center.x - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.center.y - rect.top) / rect.height) * 2 + 1;
      onMouseClick({ clientX: e.center.x, clientY: e.center.y });
    });
  
    // Double tap → recenter
    hammer.on('doubletap', () => {
      setupInitialView();
    });
  
    // Prevent pinch from also triggering pinch-zoom on the page
    renderer.domElement.style.touchAction = 'none';
  }
  

// Add mouse event handlers for inertia effect
function onMapMouseDown(event) {
    isMouseDown = true;
    inertia = { x: 0, y: 0, z: 0 };
    lastMousePosition = { x: event.clientX, y: event.clientY };
}

function onMapMouseMove(event) {
    if (isMouseDown && inertiaEnabled) {
        // Update inertia based on mouse movement
        inertia.x = (event.clientX - lastMousePosition.x) * 0.01;
        inertia.y = (event.clientY - lastMousePosition.y) * 0.01;
        lastMousePosition = { x: event.clientX, y: event.clientY };
    }
}

function onMapMouseUp(event) {
    if (!isMouseDown) return;
    isMouseDown = false;
    
    // Calculate inertia based on last movement with improved feel
    if (inertiaEnabled) {
        // Calculate movement velocity with smoothing
        const dx = event.clientX - lastMousePosition.x;
        const dy = event.clientY - lastMousePosition.y;
        
        // Use exponential scaling for more natural feeling inertia
        const magnitude = Math.sqrt(dx*dx + dy*dy);
        const scaleFactor = 0.03 * Math.min(1, magnitude / 50);
        
        inertia.x = dx * scaleFactor;
        inertia.y = dy * scaleFactor;
    }
}

// Modify the onMouseClick function to use smooth navigation
function onMouseClick(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    if (model) {
        const allIntersects = raycaster.intersectObjects(model.children, true);

        const intersects = allIntersects.filter(intersect => {
            if (intersect.object.name === "EXPORT_GOOGLE_MAP_WM") return false;
            if (intersect.object.userData.isGround) return false;
            return intersect.object.userData.isInteractiveBuilding;
        });

        if (intersects.length > 0) {
            const clickedObject = intersects[0].object;

            // Deselect previous building
            if (selectedBuilding) {
                selectedBuilding.material.color.copy(selectedBuilding.userData.originalColor);
            }

            // Highlight the selected building
            selectedBuilding = clickedObject;
            selectedBuilding.material.color.setHex(0x00ff00);

            // 🌍 Get world position (pivot/origin)
            const pivotPos = new THREE.Vector3();
            clickedObject.getWorldPosition(pivotPos);

            // 📦 Get bounding box center (recommended for GPS anchoring)
            const bbox = new THREE.Box3().setFromObject(clickedObject);
            const bboxCenter = bbox.getCenter(new THREE.Vector3());

            // 🖨️ Log both for debugging and GPS calibration
            console.log(`--- 🏢 Selected Building: ${clickedObject.name} ---`);
            console.log(`📍 Object Pivot (World Position):`);
            console.log(`    X: ${pivotPos.x.toFixed(4)}`);
            console.log(`    Y: ${pivotPos.y.toFixed(4)}`);
            console.log(`    Z: ${pivotPos.z.toFixed(4)}`);
            console.log(`📦 Bounding Box Center (World Position):`);
            console.log(`    X: ${bboxCenter.x.toFixed(4)}`);
            console.log(`    Y: ${bboxCenter.y.toFixed(4)}`);
            console.log(`    Z: ${bboxCenter.z.toFixed(4)}`);

            // Proceed with navigation and info
            smoothNavigateToBuilding(clickedObject);
            updateBuildingInfo(clickedObject);
        } else if (selectedBuilding) {
            selectedBuilding.material.color.copy(selectedBuilding.userData.originalColor);
            selectedBuilding = null;
            document.getElementById('infoSidebar').innerHTML = '';
        }
    }
}


// Add a smooth navigation function for clicking on buildings
function smoothNavigateToBuilding(building) {
    if (!building) return;
    
    // Get building position
    const buildingPosition = new THREE.Vector3();
    const boundingBox = new THREE.Box3().setFromObject(building);
    boundingBox.getCenter(buildingPosition);
    
    // Store current positions
    const startTargetPos = controls.target.clone();
    const startCameraPos = camera.position.clone();
    
    // Calculate the end position for the camera target (the building)
    const endTargetPos = buildingPosition.clone();
    
    // Calculate a good viewing position
    const height = camera.position.y - controls.target.y; // Maintain height
    const direction = new THREE.Vector3(0.3, 0, 0.3).normalize(); // Slight angle
    const endCameraPos = endTargetPos.clone().add(
        new THREE.Vector3(direction.x * height, height, direction.z * height)
    );
    
    // Animate the camera movement
    const duration = 1000; // 1 second
    const startTime = Date.now();
    
    function animateCamera() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Use easing function for smoother motion
        const easedProgress = easeInOutCubic(progress);
        
        // Interpolate positions
        controls.target.lerpVectors(startTargetPos, endTargetPos, easedProgress);
        camera.position.lerpVectors(startCameraPos, endCameraPos, easedProgress);
        
        // Continue until completed
        if (progress < 1) {
            requestAnimationFrame(animateCamera);
        }
    }
    
    // Easing function for smooth acceleration/deceleration
    function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
    
    // Start animation
    animateCamera();
}

function onMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    if (model) {
        // Get all intersections
        const allIntersects = raycaster.intersectObjects(model.children, true);
        
        // Filter out the ground and the XPORT_GOOGLE_MAP_WM base surface
        const intersects = allIntersects.filter(intersect => {
            // Check if the object has a name "XPORT_GOOGLE_MAP_WM"
            if (intersect.object.name === "EXPORT_GOOGLE_MAP_WM") return false;
            
            // Check if it's marked as ground
            if (intersect.object.userData.isGround) return false;
            
            // Only include objects marked as interactive buildings
            return intersect.object.userData.isInteractiveBuilding;
        });
        
        const tooltip = document.getElementById('tooltip');

        // Reset color for previously hovered buildings
        model.traverse((child) => {
            if (child.userData.isInteractiveBuilding && child !== selectedBuilding) {
                child.material.color.copy(child.userData.originalColor);
            }
        });

        if (intersects.length > 0) {
            const hoveredObject = intersects[0].object;
            if (hoveredObject !== selectedBuilding) {
                // Only highlight the specific hovered building
                hoveredObject.material.color.setHex(0xff7700);
                
                const info = hoveredObject.userData.buildingData;
                if (info) {
                    tooltip.style.display = "block";
                    tooltip.innerHTML = `
                        <strong>${info.display_name || info.name || hoveredObject.name}</strong>
                        ${info.description ? `<span style="color: #5d6b88; display: block; margin-top: 5px;">${info.description}</span>` : ''}
                        ${info.departments ? `<small style="color: #2979ff; font-weight: 600; margin-top: 5px; display: block;">Departments: ${info.departments.length}</small>` : ''}
                    `;
                } else {
                    tooltip.style.display = "block";
                    tooltip.innerHTML = `<strong>${hoveredObject.name}</strong>`;
                }
                tooltip.style.left = `${event.clientX + 10}px`;
                tooltip.style.top = `${event.clientY + 10}px`;
            } else {
                tooltip.style.display = "none";
            }
        } else {
            tooltip.style.display = "none";
        }
    }
}

// Update the onWindowResize function to recalculate boundaries
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    
    // Recalculate boundaries in case window size affects optimal viewing
    calculateMapBoundaries();
}

// Modify the animate function to include improved inertia and boundary checks
function animate() {
    requestAnimationFrame(animate);
    
    // Apply inertia if enabled and mouse is not down
    if (inertiaEnabled && !isMouseDown && (Math.abs(inertia.x) > 0.01 || Math.abs(inertia.y) > 0.01)) {
        // Get the current camera direction in the horizontal plane
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        forward.y = 0;
        forward.normalize();
        
        // Get the right vector
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        right.y = 0;
        right.normalize();
        
        // Apply logarithmic damping for more natural deceleration
        const currentMagnitude = Math.sqrt(inertia.x * inertia.x + inertia.y * inertia.y);
        const newMagnitude = currentMagnitude * damping;
        
        if (currentMagnitude > 0) {
            inertia.x = (inertia.x / currentMagnitude) * newMagnitude;
            inertia.y = (inertia.y / currentMagnitude) * newMagnitude;
        }
        
        // Move the camera and target with inertia
        const movement = new THREE.Vector3()
            .add(right.multiplyScalar(-inertia.x * 0.5)) // Reduced movement strength
            .add(forward.multiplyScalar(-inertia.y * 0.5));
        
        camera.position.add(movement);
        controls.target.add(movement);
        
        // If inertia is very small, stop it
        if (Math.abs(inertia.x) < 0.01) inertia.x = 0;
        if (Math.abs(inertia.y) < 0.01) inertia.y = 0;
    }
    
    // Apply damping for more natural camera movement
    controls.update();
    
    // Apply boundaries to keep camera within map bounds with improved boundary handling
    if (mapBounds) {
        const targetPosition = controls.target.clone();
        const cameraOffset = new THREE.Vector3().subVectors(camera.position, controls.target);
        
        // Create a smaller boundary box for smoother edge behavior
        const margin = new THREE.Vector3(
            mapBounds.max.x - mapBounds.min.x,
            0,
            mapBounds.max.z - mapBounds.min.z
        ).multiplyScalar(0.05); // 5% margin
        
        const innerBounds = {
            min: new THREE.Vector3().copy(mapBounds.min).add(margin),
            max: new THREE.Vector3().copy(mapBounds.max).sub(margin)
        };
        
        // Gradual boundary enforcement
        let isAdjusted = false;
        const boundaryDamping = 0.1;
        
        if (targetPosition.x < innerBounds.min.x) {
            targetPosition.x += (innerBounds.min.x - targetPosition.x) * boundaryDamping;
            isAdjusted = true;
        } else if (targetPosition.x > innerBounds.max.x) {
            targetPosition.x -= (targetPosition.x - innerBounds.max.x) * boundaryDamping;
            isAdjusted = true;
        }
        
        if (targetPosition.z < innerBounds.min.z) {
            targetPosition.z += (innerBounds.min.z - targetPosition.z) * boundaryDamping;
            isAdjusted = true;
        } else if (targetPosition.z > innerBounds.max.z) {
            targetPosition.z -= (targetPosition.z - innerBounds.max.z) * boundaryDamping;
            isAdjusted = true;
        }
        
        // Apply adjustment with smooth transition
        if (isAdjusted) {
            controls.target.lerp(targetPosition, 0.2);
            camera.position.copy(controls.target).add(cameraOffset);
            
            // Reduce inertia when hitting boundaries
            inertia.x *= 0.8;
            inertia.y *= 0.8;
        }
    }
    
    renderer.render(scene, camera);
    
    // Update compass rotation based on camera
    const compass = document.getElementById('compass');
    if (compass) {
        const rotation = Math.atan2(
            camera.position.x - controls.target.x,
            camera.position.z - controls.target.z
        );
        compass.style.transform = `rotate(${rotation}rad)`;
    }
}

function setupEventListeners() {
    renderer.domElement.addEventListener('click', onMouseClick, false);
    renderer.domElement.addEventListener('mousemove', onMouseMove, false);
    renderer.domElement.addEventListener('mousedown', onMapMouseDown, false);
    renderer.domElement.addEventListener('mousemove', onMapMouseMove, false);
    renderer.domElement.addEventListener('mouseup', onMapMouseUp, false);
    renderer.domElement.addEventListener('mouseleave', onMapMouseUp, false);
    window.addEventListener('resize', onWindowResize, false);
}

function updateBuildingInfo(building) {
    const sidebar = document.getElementById('infoSidebar');
    const info = building.userData.buildingData;

    if (!info) {
        sidebar.innerHTML = `
            <h2>${building.name}</h2>
            <div class="info-section">
                <div class="content">
                    <p>Loading building information...</p>
                </div>
            </div>
        `;
        return;
    }
    
    sidebar.innerHTML = `
        <button id="sidebarBackBtn" class="sidebar-back-btn">
            <i class="fa fa-arrow-left"></i> Back
        </button>
        ${info.img_URL ? `<img src="${info.img_URL}" alt="${info.name || building.name}" style="width:100%;max-height:180px;object-fit:cover;border-radius:10px;margin-bottom:14px;box-shadow:0 2px 12px rgba(41,121,255,0.13);">` : ''}
        <h2>${info.display_name || info.name || building.name}</h2>
        <div class="building-details">
            ${info.contact ? `<div class="info-section contact"><h3><i class='fa fa-phone' style='margin-right:7px;'></i>Contact</h3><div class="content">${(() => {
                // Split by comma, semicolon, or whitespace
                const contacts = info.contact.split(/[,;\s]+/).filter(Boolean);
                const phones = contacts.filter(c => /^\+?\d{7,}$/.test(c.replace(/[-\s()]/g, "")));
                const emails = contacts.filter(c => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c));
                let html = '';
                html += phones.map(c => `<span style='display:flex;align-items:center;gap:7px;margin-bottom:4px;'><i class=\"fa fa-phone\" style=\"color:#1976d2;\"></i> <a href='tel:${c}' style='color:#1976d2;text-decoration:underline;'>${c}</a></span>`).join('');
                html += emails.map(c => `<span style='display:flex;align-items:center;gap:7px;margin-bottom:4px;word-break:break-all;'><i class=\"fa fa-envelope\" style=\"color:#1976d2;\"></i> <a href='mailto:${c}' style='color:#1976d2;text-decoration:underline;word-break:break-all;'>${c}</a></span>`).join('');
                return html;
            })()}</div></div>` : ''}
            <div class="info-section departments clickable" id="viewDepartmentsBtn">
                <h3>Departments <span class="department-count">${info.departments ? info.departments.length : 0}</span></h3>
                <div class="content">
                    <p>Click to view department details</p>
                </div>
            </div>
            ${info.Courses ? `
                <div class="info-section courses">
                    <h3><i class='fa fa-graduation-cap' style='margin-right:7px;'></i>Courses</h3>
                    <div class="content">
                        ${info.Courses.split(',').map(c => `<div style='color:#18181c;'>${c.trim()}</div>`).join('')}
                    </div>
                </div>
            ` : ''}
            ${info.facilities ? `
                <div class="info-section facilities">
                    <h3>Facilities</h3>
                    <div class="content">
                        <p>${info.facilities}</p>
                    </div>
                </div>
            ` : ''}
            ${info['other details'] ? `
                <div class="info-section other-details">
                    <h3>Other Details</h3>
                    <div class="content">
                        <p>${info['other details']}</p>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
    // Add back button handler
    const backBtn = document.getElementById('sidebarBackBtn');
    if (backBtn) {
        backBtn.onclick = function() {
            sidebar.innerHTML = `
                <div class="sidebar-welcome" style="text-align:center;color:#1976d2;font-size:1.1em;padding:24px 0 10px 0;">
                    <i class='fa fa-info-circle' style='font-size:1.7em;display:block;margin-bottom:8px;'></i>
                    <div style='font-weight:600;font-size:1.15em;margin-bottom:4px;'>Welcome!</div>
                    <div style='color:#34495e;font-size:1em;'>Please select a building to view its details.</div>
                </div>
                <button id="facilitiesBtn" class="facility-btn"><i class="fa fa-building"></i> Facilities</button>
            `;
            // Re-attach facilities button logic
            const facilitiesBtn = document.getElementById('facilitiesBtn');
            if (facilitiesBtn) {
                facilitiesBtn.onclick = function() {
                    const list = document.getElementById('facilityTypeList');
                    list.innerHTML = '';
                    facilityTypes.forEach(type => {
                        const li = document.createElement('li');
                        li.textContent = type;
                        li.onclick = () => {
                            showFacilitiesOnMap(type);
                            closeFacilitiesModal();
                        };
                        list.appendChild(li);
                    });
                    document.getElementById('facilitiesModal').style.display = 'block';
                };
            }
        };
    }
    // Add departments button handler
    const viewDepartmentsBtn = document.getElementById('viewDepartmentsBtn');
    if (viewDepartmentsBtn) {
        viewDepartmentsBtn.onclick = function() {
            showDepartmentModal(info.departments);
        };
    }
}

function showDepartmentModal(departments) {
    const modal = document.getElementById('departmentModal');
    const modalContent = document.getElementById('departmentModalContent');
    if (!modal || !modalContent) return;

    if (departments && departments.length > 0) {
        modalContent.innerHTML = departments.map(dept => `
            <div class="department-card">
                <strong>${dept.dept_name}</strong><br>
                HOD: ${dept.HOD}<br>
                Contact: ${dept.contact}<br>
                Students: ${dept.student_count}
            </div>
        `).join('');
    } else {
        modalContent.innerHTML = '<p>No departments found for this building.</p>';
    }
    modal.style.display = 'flex';

    // Close modal on click of close button or outside modal
    document.querySelector('.department-modal-close').onclick = () => modal.style.display = 'none';
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
}

// Update Find Path and Clear Path button logic to use the internal name
// Replace references to startBuildingInput and endBuildingInput with display name mapping

document.getElementById('findPathButton').addEventListener('click', () => {
    const startInput = document.getElementById('startBuildingInput');
    const endInput = document.getElementById('endBuildingInput');
    
    if (!startInput || !endInput) {
        console.error("Could not find building input fields");
        return;
    }
    
    const startDisplay = startInput.value;
    const endDisplay = endInput.value;
    
    // FIXED: Improved logging and error handling for pathfinding
    console.log(`Finding path from "${startDisplay}" to "${endDisplay}"`);
    
    // Get internal names, handling Current Location specially
    let startBuilding = startDisplay.trim().toLowerCase() === 'current location' 
        ? "_CURRENT_LOCATION_" 
        : (displayNameToInternalName[startDisplay] || startDisplay);
        
    const endBuilding = displayNameToInternalName[endDisplay] || endDisplay;
    
    if (!startBuilding || !endBuilding) {
        Swal.fire({
            icon: 'warning',
            title: 'Selection Required',
            text: 'Please select both start and end buildings'
        });
        return;
    }
    
    if (startBuilding === endBuilding) {
        Swal.fire({
            icon: 'warning',
            title: 'Same Building',
            text: 'Start and end buildings must be different'
        });
        return;
    }
    
    // Check for "Current Location" selection
    if (startBuilding === "_CURRENT_LOCATION_") {
        // FIXED: Show the same navigation prompt as for regular buildings
        // Verify GPS is active and a position is available
        if (!window.gpsTracker || !window.lastPosition || !window.lastPosition.coords) {
            // Start GPS and show loading message
            if (window.gpsTracker && typeof window.gpsTracker.start === 'function') {
                window.gpsTracker.start();
                
                Swal.fire({
                    icon: 'info',
                    title: 'Starting GPS',
                    text: 'Please wait while we get your location...',
                    timer: 4000,
                    timerProgressBar: true
                }).then(() => {
                    if (window.lastPosition) {
                        console.log("GPS position acquired, finding path");
                        
                        // First calculate the path without navigation
                        const path = findPathFromCurrentLocationTo(endBuilding);
                        
                        if (!path) {
                            Swal.fire({
                                icon: 'error',
                                title: 'No Path Found',
                                text: 'Could not find a path from your current location to the destination'
                            });
                            return;
                        }
                        
                        // FIXED: Show the navigation prompt
                        Swal.fire({
                            title: 'Start Navigation?',
                            text: 'Would you like to use GPS navigation to guide you to the destination?',
                            icon: 'question',
                            showCancelButton: true,
                            confirmButtonText: 'Yes, Navigate',
                            cancelButtonText: 'No, Just Show Path'
                        }).then((result) => {
                            if (result.isConfirmed) {
                                // If user confirms, start navigation mode
                                if (window.navigationSystem && typeof window.navigationSystem.start === 'function') {
                                    // Clear any existing paths first
                                    if (typeof window.clearPath === 'function') {
                                        window.clearPath();
                                    } else if (typeof clearPath === 'function') {
                                        clearPath();
                                    }
                                    
                                    console.log("Starting navigation to:", endBuilding);
                                    window.navigationSystem.start(endBuilding);
                                } else {
                                    console.error("Navigation system not available");
                                }
                            }
                        });
                    } else {
                        Swal.fire({
                            icon: 'error',
                            title: 'GPS Not Available',
                            text: 'Please enable GPS tracking to use your current location',
                            confirmButtonText: 'Try Again',
                            showCancelButton: true,
                            cancelButtonText: 'Cancel'
                        }).then((result) => {
                            if (result.isConfirmed) {
                                // Trigger the click event again
                                document.getElementById('findPathButton').click();
                            }
                        });
                    }
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'GPS Not Available',
                    text: 'Please enable GPS tracking to use your current location',
                    footer: '<a href="#" onclick="window.gpsTracker.start()">Start GPS Tracking</a>'
                });
            }
            return;
        }
        
        // We already have GPS position
        console.log("GPS already active, finding path");
        const path = findPathFromCurrentLocationTo(endBuilding);
        
        if (!path) {
            Swal.fire({
                icon: 'error',
                title: 'No Path Found',
                text: 'Could not find a path from your current location to the destination'
            });
            return;
        }
        
        // FIXED: Show navigation prompt after finding path
        Swal.fire({
            title: 'Start Navigation?',
            text: 'Would you like to use GPS navigation to guide you to the destination?',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Yes, Navigate',
            cancelButtonText: 'No, Just Show Path'
        }).then((result) => {
            if (result.isConfirmed) {
                // If user confirms, start navigation mode
                if (window.navigationSystem && typeof window.navigationSystem.start === 'function') {
                    // Clear any existing paths first
                    if (typeof window.clearPath === 'function') {
                        window.clearPath();
                    } else if (typeof clearPath === 'function') {
                        clearPath();
                    }
                    
                    console.log("Starting navigation to:", endBuilding);
                    window.navigationSystem.start(endBuilding);
                } else {
                    console.error("Navigation system not available");
                }
            }
        });
    } else {
        // Regular building-to-building path
        const path = findPathBetweenBuildings(startBuilding, endBuilding);
        
        if (!path) {
            Swal.fire({
                icon: 'error',
                title: 'No Path Found',
                text: 'Could not find a path between the selected buildings'
            });
            return;
        }
        
        // Show option to start navigation (this was already here)
        Swal.fire({
            title: 'Start Navigation?',
            text: 'Would you like to use your current GPS position to navigate to this destination?',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Yes, Navigate',
            cancelButtonText: 'No, Just Show Path'
        }).then((result) => {
            if (result.isConfirmed) {
                // If user confirms, start navigation mode
                if (window.navigationSystem && typeof window.navigationSystem.start === 'function') {
                    // Clear any existing paths first
                    if (typeof window.clearPath === 'function') {
                        window.clearPath();
                    } else if (typeof clearPath === 'function') {
                        clearPath();
                    }
                    
                    console.log("Starting navigation to:", endBuilding);
                    window.navigationSystem.start(endBuilding);
                } else {
                    console.error("Navigation system not available");
                    
                    // Fallback if navigationSystem is not available
                    if (!window.gpsTracker || !window.lastPosition) {
                        console.log("Starting GPS tracking...");
                        if (window.gpsTracker && typeof window.gpsTracker.start === 'function') {
                            window.gpsTracker.start();
                        }
                    }
                    
                    // Try again to find path from current location
                    findPathFromCurrentLocationTo(endBuilding);
                }
            }
        });
    }
});

document.getElementById('clearPathButton').addEventListener('click', clearPath);

// Placeholder for pathfinding functions

// Add a method to update lighting for time of day
function updateLightingForTimeOfDay(hour) {
    // Get the main directional light
    let sunLight;
    scene.traverse(child => {
        if (child.isDirectionalLight && child.intensity >= 0.8) {
            sunLight = child;
        }
    });
    
    if (!sunLight) return;
    
    // Normalize hour to 0-24 range
    hour = hour % 24;
    
    // Calculate sun position based on time
    const angle = ((hour - 6) / 12) * Math.PI; // Noon at PI/2
    const height = Math.sin(angle);
    const distance = 200;
    
    sunLight.position.x = Math.cos(angle) * distance;
    sunLight.position.y = Math.max(height, 0.1) * distance; // Keep sun slightly above horizon
    sunLight.position.z = Math.sin(angle + Math.PI/4) * distance; // Add offset for angle
    
    // Adjust light color and intensity based on time
    if (hour >= 5 && hour < 8) { // Sunrise
        sunLight.color.setHex(0xffd7a8);
        sunLight.intensity = 0.8;
    } else if (hour >= 8 && hour < 16) { // Day
        sunLight.color.setHex(0xfffaf0);
        sunLight.intensity = 1.0;
    } else if (hour >= 16 && hour < 19) { // Sunset
        sunLight.color.setHex(0xffa075);
        sunLight.intensity = 0.8;
    } else { // Night
        sunLight.color.setHex(0x334455);
        sunLight.intensity = 0.3;
    }
    
    // Adjust scene ambient light
    scene.traverse(child => {
        if (child.isAmbientLight) {
            if (hour >= 5 && hour < 19) { // Daytime
                child.intensity = 0.3;
            } else { // Nighttime
                child.intensity = 0.1;
            }
        }
        
        if (child.isHemisphereLight) {
            if (hour >= 5 && hour < 19) { // Daytime
                child.intensity = 0.4;
            } else { // Nighttime
                child.intensity = 0.2;
            }
        }
    });
}

// Example usage: updateLightingForTimeOfDay(15); // 3 PM lighting

// Initialize and start animation
init();
animate();

// Set default sidebar content on load
window.addEventListener('DOMContentLoaded', function() {
    var sidebar = document.getElementById('infoSidebar');
    if (sidebar) {
        var welcome = sidebar.querySelector('.sidebar-welcome');
        if (welcome) {
            welcome.innerHTML = `
                <i class='fa fa-info-circle'></i>
                <div>Welcome!</div>
                <div>Please select a building to view its details.</div>
            `;
        }
    }

    // Facilities button/modal logic
    const facilitiesBtn = document.getElementById('facilitiesBtn');
    const facilitiesModal = document.getElementById('facilitiesModal');
    const facilityTypeList = document.getElementById('facilityTypeList');
    const facilitiesModalClose = document.querySelector('.facility-modal-close');

    if (facilitiesBtn && facilitiesModal && facilityTypeList && facilitiesModalClose) {
        facilitiesBtn.onclick = function() {
            facilityTypeList.innerHTML = '';
            facilityTypes.forEach(type => {
                const li = document.createElement('li');
                li.textContent = type;
                li.onclick = () => {
                    showFacilitiesOnMap(type);
                    facilitiesModal.style.display = 'none';
                };
                facilityTypeList.appendChild(li);
            });
            facilitiesModal.style.display = 'flex';
        };
        facilitiesModalClose.onclick = function() {
            facilitiesModal.style.display = 'none';
        };
        facilitiesModal.onclick = function(e) {
            if (e.target === facilitiesModal) facilitiesModal.style.display = 'none';
        };
    }
});

// --- Facility Markers Logic (GLOBAL SCOPE) ---

// Fetch facilities by type from Supabase
async function fetchFacilitiesByType(type) {
    const { data, error } = await supabase
        .from('facilities')
        .select('id, building_id, type, location_note')
        .eq('type', type);

    if (error) {
        console.error('Error fetching facilities:', error);
        return [];
    }
    return data;
}

// Store facility markers for removal
let facilityMarkers = [];

function removeFacilityMarkers() {
    facilityMarkers.forEach(marker => {
        scene.remove(marker);
    });
    facilityMarkers = [];
}

// Create a Google Maps-style red pin marker
function addFacilityMarkerToBuilding(buildingId, facilityType) {
    // Find the building object in the 3D scene by building_id
    let buildingObj = null;
    model.traverse(obj => {
        if (obj.userData && obj.userData.buildingData && obj.userData.buildingData.id === buildingId) {
            buildingObj = obj;
        }
    });
    if (!buildingObj) {
        console.log('No building found for facility:', buildingId);
        return;
    }

    // Get building position (center)
    const bbox = new THREE.Box3().setFromObject(buildingObj);
    const center = bbox.getCenter(new THREE.Vector3());

    // Create a Google Maps-style pin
    const markerGroup = new THREE.Group();

    // Pin head (cone)
    const pinHeadGeo = new THREE.ConeGeometry(7, 22, 32);
    const pinHeadMat = new THREE.MeshPhongMaterial({
        color: 0x5d84c2, // updated to match our pale theme
        shininess: 100,
        specular: 0xffffff
    });
    const pinHead = new THREE.Mesh(pinHeadGeo, pinHeadMat);
    pinHead.position.y = 11; // half of cone height
    pinHead.rotation.x = Math.PI; // point down

    // Pin base (sphere)
    const pinBaseGeo = new THREE.SphereGeometry(4.5, 32, 32);
    const pinBaseMat = new THREE.MeshPhongMaterial({
        color: 0x5d84c2, // updated to match our pale theme
        shininess: 100,
        specular: 0xffffff
    });
    const pinBase = new THREE.Mesh(pinBaseGeo, pinBaseMat);
    pinBase.position.y = 0;

    // White border for the base (for extra pop)
    const borderGeo = new THREE.SphereGeometry(5.2, 32, 32);
    const borderMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85
    });
    const border = new THREE.Mesh(borderGeo, borderMat);
    border.position.y = 0;

    markerGroup.add(border);
    markerGroup.add(pinBase);
    markerGroup.add(pinHead);

    // Position above building (lowered)
    markerGroup.position.copy(center);
    markerGroup.position.y += 25; // Lowered from 40 to 25

    scene.add(markerGroup);
    facilityMarkers.push(markerGroup);

    console.log('Added Google Maps-style marker for building:', buildingId, 'at', markerGroup.position);
}

// Add a floating Clear Facilities button
function showClearFacilitiesButton() {
    let btn = document.getElementById('clearFacilitiesBtn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'clearFacilitiesBtn';
        btn.textContent = 'Clear Facilities';
        btn.style.position = 'fixed';
        btn.style.bottom = '100px';
        btn.style.left = '32px';
        btn.style.zIndex = '2000';
        btn.style.padding = '14px 28px';
        btn.style.fontSize = '1.1em';
        btn.style.borderRadius = '14px';
        btn.style.background = 'linear-gradient(135deg,#f2f4f8 60%,#5d84c2 100%)';
        btn.style.color = '#5d84c2';
        btn.style.boxShadow = '0 4px 16px rgba(93, 132, 194, 0.15)';
        btn.style.fontWeight = '700';
        btn.style.display = 'inline-flex';
        btn.style.alignItems = 'center';
        btn.style.gap = '10px';
        btn.style.border = 'none';
        btn.style.cursor = 'pointer';
        btn.style.transition = 'background 0.2s,box-shadow 0.2s,transform 0.2s';
        btn.innerHTML = '<i class="fa fa-times"></i> Clear Facilities';
        btn.onmouseenter = function() { 
            btn.style.background = 'linear-gradient(135deg,#5d84c2 60%,#f2f4f8 100%)'; 
            btn.style.color = '#ffffff';
        };
        btn.onmouseleave = function() { 
            btn.style.background = 'linear-gradient(135deg,#f2f4f8 60%,#5d84c2 100%)';
            btn.style.color = '#5d84c2';
        };
        btn.onclick = function() {
            removeFacilityMarkers();
            btn.style.display = 'none';
        };
        document.body.appendChild(btn);
    }
    btn.style.display = 'inline-flex';
}

// Modify showFacilitiesOnMap to show the button
async function showFacilitiesOnMap(type) {
    const facilities = await fetchFacilitiesByType(type);
    removeFacilityMarkers();

    // Fetch building names for each facility
    const buildingNames = {};
    for (const facility of facilities) {
        // Find building object by id
        let buildingObj = null;
        model.traverse(obj => {
            if (obj.userData && obj.userData.buildingData && obj.userData.buildingData.id === facility.building_id) {
                buildingObj = obj;
            }
        });
        if (buildingObj) {
            buildingNames[facility.building_id] = buildingObj.userData.buildingData.name || 'Unknown';
        }
        addFacilityMarkerToBuilding(facility.building_id, facility.type);
    }
    showClearFacilitiesButton();
}

window.showFacilitiesOnMap = showFacilitiesOnMap;

function populateBuildingDatalist() {
    if (!model) return;
    
    // Create separate lists for start and end buildings
    const startDatalist = document.getElementById('startBuildingList');
    const endDatalist = document.getElementById('endBuildingList');
    
    // Clear existing options
    if (startDatalist) startDatalist.innerHTML = '';
    if (endDatalist) endDatalist.innerHTML = '';
    
    if (!startDatalist || !endDatalist) {
        console.error("Could not find building datalists");
        return;
    }
    
    const buildings = [];
    // Clear the mapping but preserve the reference
    Object.keys(displayNameToInternalName).forEach(key => {
        delete displayNameToInternalName[key];
    });
    
    model.traverse((object) => {
        if (object.userData && object.userData.isInteractiveBuilding) {
            const info = object.userData.buildingData;
            const display = info && info.display_name ? info.display_name : (info && info.name ? info.name : object.name);
            buildings.push(display);
            displayNameToInternalName[display] = object.name;
            
            // Log each mapping for debugging
            console.log(`Mapping display name '${display}' to internal name '${object.name}'`);
        }
    });
    buildings.sort((a, b) => a.localeCompare(b));
    
    // Add Current Location option at the top of the START list only
    // FIXED: Make sure Current Location option is properly added
    const currentLocationOption = document.createElement('option');
    currentLocationOption.value = "Current Location";
    currentLocationOption.textContent = "Current Location";
    startDatalist.appendChild(currentLocationOption);
    
    // Add the Current Location to displayNameToInternalName mapping for special handling
    displayNameToInternalName["Current Location"] = "_CURRENT_LOCATION_";
    
    // Ensure the global version is updated
    window.displayNameToInternalName = displayNameToInternalName;
    
    // Add all buildings to both lists
    buildings.forEach(name => {
        // Add to start building list
        const startOption = document.createElement('option');
        startOption.value = name;
        startOption.textContent = name;
        startDatalist.appendChild(startOption);
        
        // Add to end building list
        const endOption = document.createElement('option');
        endOption.value = name;
        endOption.textContent = name;
        endDatalist.appendChild(endOption);
    });
    
    // Debug: log the datalist contents
    console.log('Start datalist populated with buildings:', ["Current Location", ...buildings]);
    console.log('End datalist populated with buildings:', buildings);
    console.log('Building name mapping object:', displayNameToInternalName);
    
    // FIXED: Ensure the input fields trigger correctly
    setupBuildingInputListeners();
}

// FIXED: Add function to set up input listeners for better handling of "Current Location"
function setupBuildingInputListeners() {
    const startInput = document.getElementById('startBuildingInput');
    const endInput = document.getElementById('endBuildingInput');
    
    if (startInput) {
        // When the start input field changes, check if it's "Current Location"
        startInput.addEventListener('change', function() {
            if (this.value.trim().toLowerCase() === 'current location') {
                console.log("Start location set to Current Location");
                this.value = "Current Location"; // Normalize the casing
                
                // Automatically start GPS if it's not already active
                if (window.gpsTracker && typeof window.gpsTracker.start === 'function' && !window.lastPosition) {
                    console.log("Starting GPS for Current Location");
                    window.gpsTracker.start();
                }
            }
        });
    }
}

function clearPath() {
    // Remove the path visualization group if it exists
    const GROUP_NAME = 'path-visual';
    if (scene) {
        const old = scene.getObjectByName(GROUP_NAME);
        if (old) scene.remove(old);
    }
    // Optionally clear any path state variables if needed
    if (typeof pathLine !== 'undefined') pathLine = null;
    if (typeof currentPath !== 'undefined') currentPath = null;
    // Clear the search bar values
    const startInput = document.getElementById('startBuildingInput');
    const endInput = document.getElementById('endBuildingInput');
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
    console.log('Path and search bars cleared');
}

// Function to find path from current GPS location to a destination
function findPathFromCurrentLocationTo(endName) {
    console.log('Finding path from current location to:', endName);
    
    // Find destination building
    const endObj = findBuildingByName(endName);
    if (!endObj) {
        console.warn("Destination building not found:", endName);
        return null;
    }
    
    // Get current GPS position and convert to world coordinates
    if (!window.lastPosition || !window.lastPosition.coords) {
        console.warn("No valid GPS position available");
        console.log("lastPosition:", window.lastPosition);
        return null;
    }
    
    // Debug check for geoToWorld function
    if (typeof window.geoToWorld !== 'function') {
        console.error("geoToWorld function is not available globally!");
        
        // Try to get it from its source module
        if (typeof geoToWorld === 'function') {
            console.log("Using local geoToWorld function");
            window.geoToWorld = geoToWorld;
        } else {
            // IMPROVED: Try to import the function from gpsTracker.js
            console.error("Cannot find geoToWorld function directly - attempting to access from window object");
            
            // As a last resort, define a basic version if it's completely missing
            if (!window.geoToWorld) {
                console.warn("Creating emergency backup geoToWorld function");
                window.geoToWorld = function(latitude, longitude) {
                    // Very basic implementation
                    return { x: latitude * 100, z: longitude * 100 };
                };
            }
        }
    }
    
    const coords = window.lastPosition.coords;
    console.log("Converting GPS coordinates:", coords.latitude, coords.longitude);
    
    try {
        const worldPos = window.geoToWorld(coords.latitude, coords.longitude);
        const startPos = new THREE.Vector3(worldPos.x, 0, worldPos.z);
        
        // Get destination position
        const endPos = new THREE.Vector3();
        new THREE.Box3().setFromObject(endObj).getCenter(endPos);
        
        console.log('Start position (GPS):', startPos);
        console.log('End position:', endPos);
        
        // Find nearest graph points
        const startId = pathfinder.findNearestPointWorld(startPos);
        const endId = pathfinder.findNearestPointWorld(endPos);
        
        console.log('Nearest graph point IDs:', startId, endId);
        
        if (!startId || !endId) {
            console.warn("Could not find valid graph points");
            return null;
        }
        
        // Find path using A* algorithm
        const path = pathfinder.findPath(startId, endId);
        console.log('Computed path:', path);
        
        if (path && path.length > 1) {
            // Store the computed path in global variables to ensure accessibility
            window.fullPath = path;
            
            // IMPROVED: Clear any existing path first
            clearPath();
            
            // Enable shrink mode if in navigation
            if (window.navigationSystem && window.navigationSystem.isActive()) {
                window.isPathShrinkMode = true;
                console.log("Enabling shrink mode for navigation with improved visibility");
                console.log("With the updated getShrunkPath, the full path ahead will be visible");
            } else {
                // IMPROVED: If not in navigation, show full path
                window.isPathShrinkMode = false;
                console.log("Showing full path (not in navigation mode)");
            }
            
            try {
                // IMPROVED: Ensure we're calling the correct function
                if (typeof window.visualizePath === 'function') {
                    window.visualizePath(path);
                } else if (typeof visualizePath === 'function') {
                    visualizePath(path);
                } else {
                    throw new Error("visualizePath function not found!");
                }
                console.log("Path visualization completed with", path.length, "points");
                
                // IMPROVED: Verify that the path is visible in the scene
                const pathVisual = scene.getObjectByName('path-visual');
                if (pathVisual) {
                    console.log("✅ Path visual object found in scene with", 
                        pathVisual.children.length, "children");
                } else {
                    console.warn("⚠️ Path visual object not found in scene after visualization");
                }
                
                // IMPROVED: Force an immediate update for better responsiveness
                if (window.navigationSystem && window.navigationSystem.isActive()) {
                    updateNavigation();
                }
                
            } catch (err) {
                console.error("Error during path visualization:", err);
                console.error("Stack trace:", err.stack);
            }
        } else if (path && path.length <= 1) {
            console.warn("Path has only", path ? path.length : 0, "points - invalid");
            return null;
        } else {
            console.warn("Failed to compute a valid path from current location");
        }
        
        return path;
    } catch (err) {
        console.error("Error in findPathFromCurrentLocationTo:", err);
        console.error("Stack trace:", err.stack);
        return null;
    }
}

// Adjust setupInitialView to ensure the entire model is visible with smooth transition
function setupInitialView() {
    if (!model) return;
    
    const bbox = new THREE.Box3().setFromObject(model);
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    
    // Calculate distance based on model size to ensure full visibility
    const distance = Math.max(size.x, size.y, size.z) * 1.5;
    
    // Calculate target position
    const targetPos = center.clone();
    
    // Calculate end camera position with slight offset for better perspective
    const endPos = new THREE.Vector3(
        center.x + distance * 0.3,
        distance,
        center.z + distance * 0.3
    );
    
    // Store current positions
    const startTargetPos = controls.target.clone();
    const startCameraPos = camera.position.clone();
    
    // Animate the transition
    const duration = 1000; // 1 second
    const startTime = Date.now();
    
    function animateTransition() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Use smooth easing
        const easedProgress = easeOutQuad(progress);
        
        // Interpolate positions
        controls.target.lerpVectors(startTargetPos, targetPos, easedProgress);
        camera.position.lerpVectors(startCameraPos, endPos, easedProgress);
        
        // Continue until completed
        if (progress < 1) {
            requestAnimationFrame(animateTransition);
        } else {
            // Reset inertia
            inertia = { x: 0, y: 0, z: 0 };
        }
        
        controls.update();
    }
    
    // Easing function for smooth deceleration
    function easeOutQuad(t) {
        return t * (2 - t);
    }
    
    // Start animation
    animateTransition();
}

function toggleTiltView() {
    if (!model) return;
    
    const bbox = new THREE.Box3().setFromObject(model);
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    
    // Store current camera position for animation
    const startCameraPos = camera.position.clone();
    const startTargetPos = controls.target.clone();
    
    // Calculate end position based on current view mode
    let endCameraPos;
    if (isTopView) {
        // Switch to perspective view
        const distance = size.y * 1.8; // Reduced from 2.0 for closer view
        endCameraPos = new THREE.Vector3(
            center.x - distance * 0.8,
            distance * 0.8, 
            center.z - distance * 0.8
        );
    } else {
        // Switch to top-down view
        const distance = Math.max(size.x, size.z) * 1.8; // Reduced from 2.0
        endCameraPos = new THREE.Vector3(center.x, distance, center.z);
    }
    
    // Animate the transition
    const duration = 800; // 0.8 seconds (faster than initial view)
    const startTime = Date.now();
    
    function animateViewChange() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Use smooth easing
        const easedProgress = easeInOutQuad(progress);
        
        // Interpolate camera position
        camera.position.lerpVectors(startCameraPos, endCameraPos, easedProgress);
        
        // Smooth interpolation of target position to center
        controls.target.lerpVectors(startTargetPos, center, easedProgress);
        
        // Continue until completed
        if (progress < 1) {
            requestAnimationFrame(animateViewChange);
        } else {
            // Reset inertia when view change completes
            inertia = { x: 0, y: 0, z: 0 };
        }
        
        controls.update();
    }
    
    // Easing function
    function easeInOutQuad(t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }
    
    // Start animation
    animateViewChange();
    
    // Toggle view state
    isTopView = !isTopView;
}

// Enhanced zoom function for smoother experience
function zoomView(factor) {
    // Vector from target → camera
    const direction = new THREE.Vector3().subVectors(camera.position, controls.target);
    const distance = direction.length();
    
    // Calculate target distance with a smoothing function
    const targetDistance = distance * factor;
    const newDistance = Math.max(
        controls.minDistance,
        Math.min(controls.maxDistance, targetDistance)
    );
    
    // Store initial position for animation
    const startPos = camera.position.clone();
    const endPos = controls.target.clone().add(
        direction.normalize().multiplyScalar(newDistance)
    );
    
    // Animate the zoom transition for smoother feel
    const duration = 180; // Short duration for responsive feel
    const startTime = Date.now();
    
    function animateZoom() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Use smooth easing
        const easedProgress = easeOutQuad(progress);
        
        // Interpolate position
        camera.position.lerpVectors(startPos, endPos, easedProgress);
        
        // Continue until completed
        if (progress < 1) {
            requestAnimationFrame(animateZoom);
        }
        
        controls.update();
    }
    
    // Easing function
    function easeOutQuad(t) {
        return t * (2 - t);
    }
    
    // Start animation
    animateZoom();
}

function setupEventListeners() {
    renderer.domElement.addEventListener('click', onMouseClick, false);
    renderer.domElement.addEventListener('mousemove', onMouseMove, false);
    renderer.domElement.addEventListener('mousedown', onMapMouseDown, false);
    renderer.domElement.addEventListener('mousemove', onMapMouseMove, false);
    renderer.domElement.addEventListener('mouseup', onMapMouseUp, false);
    renderer.domElement.addEventListener('mouseleave', onMapMouseUp, false);
    window.addEventListener('resize', onWindowResize, false);
}