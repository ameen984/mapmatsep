let scene, camera, renderer, model, controls;
let raycaster, mouse;
let selectedBuilding = null;
let isTopView = true;
let buildingData = new Map();

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
            const info = {
                name: buildingName,
                description: `Information for ${buildingName}`,
                details: `Detailed information for ${buildingName}`,
                // Add more fields as needed
            };
            buildingData.set(buildingName, info);
            return info;
        } catch (error) {
            console.warn(`Failed to fetch data for ${buildingName}:`, error);
            return { name: buildingName, ...defaultInfo };
        }
    };
}

const getBuildingInfo = initializeBuildingData();

function createGround() {
    const groundGeometry = new THREE.PlaneGeometry(2000, 2000);
    const groundMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xe8e8e8,
        side: THREE.DoubleSide,
        roughness: 0.8,
        metalness: 0.2
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
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

function init() {
    const container = document.getElementById('container');
    const loadingOverlay = document.getElementById('loadingOverlay');

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5f5f5);
    
    const aspectRatio = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(45, aspectRatio, 0.1, 10000);
    camera.position.set(0, 500, 0);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    setupEnvironment();
    setupLighting();
    createGround();
    loadModel();
    setupControls();
    setupEventListeners();
}

function loadModel() {
    const loader = new THREE.GLTFLoader();
    const loadingOverlay = document.getElementById('loadingOverlay');

    loader.load(
        'model.glb',
        function (gltf) {
            if (model) scene.remove(model);
            model = gltf.scene;
            
            let hasEmbeddedLights = false;
            gltf.scene.traverse(node => {
                if (node.isLight) {
                    hasEmbeddedLights = true;
                    if (node.isDirectionalLight || node.isSpotLight) {
                        node.castShadow = true;
                        node.shadow.mapSize.width = 2048;
                        node.shadow.mapSize.height = 2048;
                    }
                }
            });
            
            if (!hasEmbeddedLights) {
                setupLighting();
            }
            
            const bbox = new THREE.Box3().setFromObject(model);
            const size = bbox.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.z);
            const targetSize = Math.min(window.innerWidth, window.innerHeight) * 0.8;
            const scale = targetSize / maxDim;
            model.scale.setScalar(scale);
            
            const center = bbox.getCenter(new THREE.Vector3());
            model.position.sub(center.multiplyScalar(scale));
            
            setupModelMaterials();
            
            scene.add(model);
            setupInitialView();
            loadingOverlay.style.display = 'none';
        },
        function (xhr) {
            const progress = (xhr.loaded / xhr.total * 100);
            console.log('Loading progress: ' + progress + '%');
        },
        function (error) {
            console.error('Error loading model:', error);
            loadingOverlay.style.display = 'none';
            Swal.fire({
                icon: 'error',
                title: 'Loading Error',
                text: 'Failed to load the 3D model. Please try refreshing the page.'
            });
        }
    );
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

function setupControls() {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controls.minDistance = 50;
    controls.maxDistance = 1000;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.minPolarAngle = 0;
    controls.enableRotate = true;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 0.8;
    
    controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE
    };

    document.getElementById('tiltButton').addEventListener('click', toggleTiltView);
    document.getElementById('zoomIn').addEventListener('click', () => zoomView(0.8));
    document.getElementById('zoomOut').addEventListener('click', () => zoomView(1.2));
}

function setupInitialView() {
    if (!model) return;
    
    const bbox = new THREE.Box3().setFromObject(model);
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    
    const distance = Math.max(size.x, size.z) * 2;
    camera.position.set(center.x, distance, center.z);
    camera.lookAt(center);
    
    controls.target.copy(center);
    controls.update();
}

function toggleTiltView() {
    if (!model) return;
    
    const bbox = new THREE.Box3().setFromObject(model);
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    
    if (isTopView) {
        const distance = size.y * 2;
        camera.position.set(
            center.x - distance,
            distance,
            center.z - distance
        );
    } else {
        const distance = Math.max(size.x, size.z) * 2;
        camera.position.set(center.x, distance, center.z);
    }
    
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
    isTopView = !isTopView;
}

function zoomView(factor) {
    const distance = camera.position.y;
    camera.position.y = Math.min(Math.max(distance * factor, controls.minDistance), controls.maxDistance);
    controls.update();
}

function setupEventListeners() {
    renderer.domElement.addEventListener('click', onMouseClick, false);
    renderer.domElement.addEventListener('mousemove', onMouseMove, false);
    window.addEventListener('resize', onWindowResize, false);
}

function onMouseClick(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    if (model) {
        const intersects = raycaster.intersectObjects(model.children, true);
        
        if (intersects.length > 0) {
            const clickedObject = intersects[0].object;
            
            if (clickedObject.userData.isInteractiveBuilding) {
                // Deselect previous building if exists
                if (selectedBuilding) {
                    selectedBuilding.material.color.copy(selectedBuilding.userData.originalColor);
                }
                
                // Select new building
                selectedBuilding = clickedObject;
                selectedBuilding.material.color.setHex(0x00ff00);
                
                updateBuildingInfo(clickedObject);
            }
        } else if (selectedBuilding) {
            // Deselect if clicking empty space
            selectedBuilding.material.color.copy(selectedBuilding.userData.originalColor);
            selectedBuilding = null;
            // Clear building info
            document.getElementById('infoSidebar').innerHTML = '';
        }
    }
}

function onMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    if (model) {
        const intersects = raycaster.intersectObjects(model.children, true);
        const tooltip = document.getElementById('tooltip');

        // Reset color for previously hovered buildings
        model.traverse((child) => {
            if (child.userData.isInteractiveBuilding && child !== selectedBuilding) {
                child.material.color.copy(child.userData.originalColor);
            }
        });

        if (intersects.length > 0) {
            const hoveredObject = intersects[0].object;
            if (hoveredObject.userData.isInteractiveBuilding && hoveredObject !== selectedBuilding) {
                // Only highlight the specific hovered building
                hoveredObject.material.color.setHex(0xff7700);
                
                const info = hoveredObject.userData.buildingInfo;
                tooltip.style.display = "block";
                tooltip.innerHTML = `<strong>${info.name}</strong><br>${info.description}`;
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


function updateBuildingInfo(building) {
    const sidebar = document.getElementById('infoSidebar');
    const info = building.userData.buildingInfo;
    
    sidebar.innerHTML = `
        <h2>${info.name}</h2>
        <p>${info.description}</p>
        <div class="building-details">
            <p><strong>Details:</strong> ${info.details}</p>
        </div>
    `;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
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