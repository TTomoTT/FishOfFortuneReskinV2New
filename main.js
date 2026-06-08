// =========================
// Core setup & utilities
// =========================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { InstancedFlow } from 'three/addons/modifiers/CurveModifier.js';
import { Water } from 'three/addons/objects/Water.js';
import { registerMessageHandler } from './messageHandler.js';

const BOARD_X_FOLLOW_CHANGE_EVENT = 'boardXFollowChange';
const BOARD_Y_FOLLOW_CHANGE_EVENT = 'boardYFollowChange';
const BOARD_DESTROYED_EVENT = 'boardDestroyed';

const SOUND_ASSETS = {
    IMPACT: 'sounds/impact.mp3',
    SWOOSH: 'sounds/swoosh.mp3'
};

const PROJECTILE_SETTINGS = {
    radius: 0.05,          
    stretchFactor: 2.0,    
    thicknessFactor: 0.7,  
    speedBase: 5.0,        
    speedRandom: 3.0       
};

const PATH_SPEED = 0.2;    
const PATH_START_OFFSET = 0.05; 

const ARROW_SETTINGS = {
    count: 18,
    baseOpacity: 0.7,      
    fadeZone: 0.03,        
    color: 0xD8B4FE        
};

const COMBAT_STANCE_SETTINGS = {
    delayMin: 0.01,         
    delayMax: 1.0,         
    durationMin: 20,       
    durationMax: 30        
};

function randomRange(min, max) {
    return min + Math.random() * (max - min);
}

// =========================
// Scene Manager
// =========================

class SceneManager {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.canvas.style.cursor = 'none';
        this.canvas.style.position = 'fixed';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';

        this.sizes = {
            width: window.innerWidth,
            height: window.innerHeight
        };

        this.scene = new THREE.Scene();
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true
        });
        this.renderer.setSize(this.sizes.width, this.sizes.height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.7; 

        this.timer = new THREE.Timer();

        this._setupCamera();
        this._setupAudio();
        this._setupLights();
        this._setupResize();
    }

    _setupCamera() {
        const frustumSize = 5.0; 
        const aspect = this.sizes.width / this.sizes.height;

        this.camera = new THREE.OrthographicCamera(
            (frustumSize * aspect) / -2,
            (frustumSize * aspect) / 2,
            frustumSize / 2,
            frustumSize / -2,
            0.01,
            50
        );

        this.camera.position.set(0, 2, 1.5); 
        this.camera.up.set(0, 0, -1);
        this.camera.lookAt(0, 0, 0.3);
    }

    _setupAudio() {
        this.audioListener = new THREE.AudioListener();
        this.camera.add(this.audioListener);
    }

    _setupLights() {
        const sun = new THREE.DirectionalLight(0xffffff, 4.2); 
        sun.castShadow = true;
        sun.position.set(5, 12, 1); 
        
        sun.shadow.mapSize.width = 2048; 
        sun.shadow.mapSize.height = 2048;
        
        sun.shadow.camera.near = 0.5;
        sun.shadow.camera.far = 25;
        sun.shadow.camera.left = -10;
        sun.shadow.camera.right = 10;
        sun.shadow.camera.top = 10;
        sun.shadow.camera.bottom = -10;
        
        sun.shadow.bias = -0.0005; 
        sun.shadow.normalBias = 0.05; 
        this.scene.add(sun);
        this.sun = sun;

        const ambientSkyColor = 0xdce2f0;   
        const ambientGroundColor = 0x5a557a; 
        const ambientLight = new THREE.HemisphereLight(ambientSkyColor, ambientGroundColor, 1.3); 
        this.scene.add(ambientLight);
    }

    _setupResize() {
        window.addEventListener('resize', () => {
            this.sizes.width = window.innerWidth;
            this.sizes.height = window.innerHeight;
            const aspect = this.sizes.width / this.sizes.height;

            const frustumSize = 5.0;
            this.camera.left = (frustumSize * aspect) / -2;
            this.camera.right = (frustumSize * aspect) / 2;
            this.camera.top = frustumSize / 2;
            this.camera.bottom = frustumSize / -2;
            this.camera.updateProjectionMatrix();

            this.renderer.setSize(this.sizes.width, this.sizes.height);
        });
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }

    getDelta(timestamp) {
        this.timer.update(timestamp);
        return this.timer.getDelta();
    }
}

// =========================
// Curve & checkerboard
// =========================

function createCurve(points) {
    return new THREE.CatmullRomCurve3(points);
}

function createCurveDebugLine(curve) {
    const curveGeometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(50));
    const curveMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
    return new THREE.Line(curveGeometry, curveMaterial);
}

function createRoundedBoxGeometry(width, height, depth, radius, segments = 12) {
    const geometry = new THREE.BoxGeometry(width, height, depth, segments, segments, segments);
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const halfDepth = depth / 2;
    const innerX = halfWidth - radius;
    const innerY = halfHeight - radius;
    const innerZ = halfDepth - radius;

    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);

        const clampedX = Math.max(-innerX, Math.min(innerX, x));
        const clampedY = Math.max(-innerY, Math.min(innerY, y));
        const clampedZ = Math.max(-innerZ, Math.min(innerZ, z));

        const dx = x - clampedX;
        const dy = y - clampedY;
        const dz = z - clampedZ;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist > 0.0001) {
            const scale = radius / dist;
            position.setXYZ(i, clampedX + dx * scale, clampedY + dy * scale, clampedZ + dz * scale);
        }
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
}

function applyOutline(object, thickness = 0.01) {
    if (!object) return;
    object.traverse((child) => {
        if (child.isMesh && !child.name.includes('outline') && child.name !== 'raycast_collider' && child.name !== 'shot_counter' && child.name !== 'Plate' && !child.name.toLowerCase().includes('plate')) {
            const outlineMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
            outlineMat.onBeforeCompile = (shader) => {
                shader.uniforms.thickness = { value: thickness };
                shader.vertexShader = `
                    uniform float thickness;
                    ${shader.vertexShader.replace(
                        '#include <begin_vertex>',
                        '#include <begin_vertex>\ntransformed += normal * thickness;'
                    )}
                `;
            };
            const outlineMesh = new THREE.Mesh(child.geometry, outlineMat);
            outlineMesh.name = child.name + '_outline';
            outlineMesh.castShadow = false;
            outlineMesh.receiveShadow = false;
            child.add(outlineMesh);
        }
    });
}

function spawnCheckerboard(scene, tileWidth = 0.3, spacing = 0.25, y = 0) {
    const rows = 1;
    const cols = 6;
    const group = new THREE.Group();
    const startX = -((cols - 1) * spacing) / 2;
    const startZ = -((rows - 1) * spacing) / 2;

    const baseMaterialOptions = {
        roughness: 0.35,
        metalness: 0.01,
        clearcoat: 0.1,
        clearcoatRoughness: 0.18,
        envMapIntensity: 0.4,
        flatShading: true
    };

    const matWhite = new THREE.MeshPhysicalMaterial(Object.assign({}, baseMaterialOptions, {
        color: 0xe6e6e6,
        metalness: 0.1,
        roughness: 0.3,
        clearcoat: 0.6,
        clearcoatRoughness: 0.12,
        envMapIntensity: 0.55
    }));
    const matBlack = new THREE.MeshPhysicalMaterial(Object.assign({}, baseMaterialOptions, {
        color: 0x111111,
        roughness: 0.4,
        metalness: 0.02
    }));

    const smallSize = tileWidth * 0.35;
    const cubeHeight = smallSize * 2; 
    const gap = tileWidth * 0.01;
    const offsetAmount = (smallSize / 2) + (gap / 2);
    const smallGeom = createRoundedBoxGeometry(smallSize, cubeHeight, smallSize, smallSize * 0.12, 4);

    const cubes = [];

    const offsets = [-offsetAmount, offsetAmount];
    for (let r = -6; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const isWhite = ((r + c) % 2 === 0);
            const mat = isWhite ? matWhite : matBlack;
            const baseX = startX + c * spacing;
            const baseZ = startZ + r * spacing;
            const extraLift = 0;

            for (let sr = 0; sr < 2; sr++) {
                for (let sc = 0; sc < 2; sc++) {
                    const offsetX = offsets[sc];
                    const offsetZ = offsets[sr];
                    const mesh = new THREE.Mesh(smallGeom, mat);
                    mesh.castShadow = true;
                    mesh.receiveShadow = true;
                    mesh.position.set(
                        baseX + offsetX,
                        y + cubeHeight / 2 + extraLift,
                        baseZ + offsetZ
                    );
                    mesh.userData.isWhite = isWhite;
                    group.add(mesh);
                    cubes.push(mesh);
                }
            }
        }
    }

    group.name = 'checkerboardGroup8';
    group.userData.cubes = cubes;
    scene.add(group);
    return group;
}

// =========================
// Shot Counter
// =========================

function createShotCounter(maxShots = 20, showTotal = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    const texture = new THREE.CanvasTexture(canvas);

    const geo = new THREE.PlaneGeometry(0.6, 0.3);
    const mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2; 
    mesh.position.y = 0.15;         

    function update(shotsLeft) {
        ctx.clearRect(0, 0, 128, 64);
        
        if (shotsLeft > 0 || showTotal) {
            const text = showTotal ? `${shotsLeft} / ${maxShots}` : `${shotsLeft}`;
            ctx.font = showTotal ? 'bold 28px sans-serif' : 'bold 36px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 5;
            ctx.strokeText(text, 64, 32);

            ctx.fillStyle = (showTotal || shotsLeft > 5) ? '#ffffff' : '#ff4444';
            ctx.fillText(text, 64, 32);
        }
        
        texture.needsUpdate = true;
    }

    update(maxShots);
    return { mesh, update };
}

// =========================
// Projectile System
// =========================

class ProjectileSystem {
    constructor(scene, checkerboardGroup, audioListener) {
        this.scene = scene;
        this.checkerboardGroup = checkerboardGroup;
        this.audioListener = audioListener;
        this.projectiles = [];
        this.particles = [];
        this.spatialGrid = new Map();
        this.gridCellSize = 0.5; 

        this.burstFireRate = 0.06;       
        this.betweenBurstDelayMin = 0.4; 
        this.betweenBurstDelayMax = 1.0; 

        this.sharedGeometry = new THREE.SphereGeometry(PROJECTILE_SETTINGS.radius, 16, 16);

        this.audioLoader = new THREE.AudioLoader();
        this.impactBuffer = null;
        this.swooshSound = new THREE.Audio(this.audioListener);

        this.audioLoader.load(SOUND_ASSETS.IMPACT, (buffer) => {
            this.impactBuffer = buffer;
        }, undefined, (err) => {
            console.error(`Failed to load impact sound at ${SOUND_ASSETS.IMPACT}:`, err);
        });

        this.audioLoader.load(SOUND_ASSETS.SWOOSH, (buffer) => {
            this.swooshSound.setBuffer(buffer);
            this.swooshSound.setVolume(0.4);
        }, undefined, (err) => {
            console.error(`Failed to load swoosh sound at ${SOUND_ASSETS.SWOOSH}:`, err);
        });
    }

    playImpact() {
        if (!this.impactBuffer) return;
        const sound = new THREE.Audio(this.audioListener);
        sound.setBuffer(this.impactBuffer);
        sound.setVolume(0.2 + Math.random() * 0.2);
        const stagger = Math.random() * 0.05; 
        setTimeout(() => {
            if (this.audioListener.context.state === 'running') sound.play();
        }, stagger * 1000);
    }

    setActive(active) {
        this.isActive = active;
    }

    _updateSpatialGrid() {
        this.spatialGrid.clear();
        const cubes = this.checkerboardGroup.userData.cubes;
        if (!cubes) return;

        for (let i = 0; i < cubes.length; i++) {
            const cube = cubes[i];
            const gx = Math.floor(cube.position.x / this.gridCellSize);
            const gz = Math.floor(cube.position.z / this.gridCellSize);
            const key = `${gx},${gz}`;
            if (!this.spatialGrid.has(key)) this.spatialGrid.set(key, []);
            this.spatialGrid.get(key).push(cube);
        }
    }

    playSwoosh() {
        if (this.swooshSound && this.swooshSound.buffer) {
            if (this.swooshSound.isPlaying) this.swooshSound.stop();
            this.swooshSound.play();
        }
    }

    _showWinMessage() {
        if (document.getElementById('win-overlay')) return;
        
        const overlay = document.createElement('div');
        overlay.id = 'win-overlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '50%';
        overlay.style.left = '50%';
        overlay.style.transform = 'translate(-50%, -50%)';
        overlay.style.display = 'flex';
        overlay.style.flexDirection = 'column';
        overlay.style.alignItems = 'center';
        overlay.style.gap = '30px';
        overlay.style.color = '#ffffff';
        overlay.style.fontFamily = 'sans-serif';
        overlay.style.textShadow = '4px 4px 15px rgba(0,0,0,0.8)';
        overlay.style.zIndex = '1000';

        const winText = document.createElement('div');
        winText.innerText = 'YOU WON';
        winText.style.fontSize = '80px';
        winText.style.fontWeight = 'bold';
        overlay.appendChild(winText);

        const btn = document.createElement('button');
        btn.innerText = 'Start Again';
        btn.style.padding = '15px 40px';
        btn.style.fontSize = '24px';
        btn.style.cursor = 'pointer';
        btn.style.backgroundColor = '#4CAF50';
        btn.style.color = 'white';
        btn.style.border = 'none';
        btn.style.borderRadius = '50px';
        btn.style.fontWeight = 'bold';
        btn.style.boxShadow = '0 10px 20px rgba(0,0,0,0.3)';
        btn.onclick = () => window.location.reload();

        overlay.appendChild(btn);
        document.body.appendChild(overlay);

        const canvas = document.getElementById('expirience-canvas');
        if (canvas) canvas.style.cursor = 'default';
    }

    _createExplosion(position) {
        const particleCount = 8;
        const geometry = new THREE.SphereGeometry(0.04, 8, 8);
        
        for (let i = 0; i < particleCount; i++) {
            const material = new THREE.MeshStandardMaterial({
                color: 0xffaa00,
                emissive: 0xff4400,
                transparent: true,
                roughness: 0.5,
                metalness: 0.5
            });
            
            const particle = new THREE.Mesh(geometry, material);
            particle.position.copy(position);
            
            const velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 4,
                (Math.random() - 0.5) * 4,
                (Math.random() - 0.5) * 4
            );

            this.particles.push({
                mesh: particle,
                velocity: velocity,
                lifetime: 0.6 + Math.random() * 0.4,
                age: 0
            });
            this.scene.add(particle);
        }
    }

    spawnFromBoard(board, count = 1) {
        if (board.userData.shotsLeft !== undefined) {
            if (board.userData.shotsLeft <= 0) return;
            board.userData.shotsLeft -= count;
            board.userData.counter?.update(board.userData.shotsLeft);
        }

        if (!board.userData.recoilVector) {
            board.userData.recoilVector = new THREE.Vector3();
        }

        for (let i = 0; i < count; i++) {
            const sphereMaterial = new THREE.MeshStandardMaterial({
                color:  0xffffff,
                emissive: 0xffffff,
                metalness: 0.6,
                roughness: 0.3,
                transparent: true,
                opacity: 0.8
            });
            const sphere = new THREE.Mesh(this.sharedGeometry, sphereMaterial);
            sphere.castShadow = true;
            sphere.receiveShadow = true;

            sphere.position.copy(board.position);

            const boardWorldXAxis = new THREE.Vector3(0, 0, -1);
            boardWorldXAxis.applyQuaternion(board.quaternion);

            if (!board.name.toLowerCase().includes('plate')) {
                const recoilStrength = 0.05;
                board.userData.recoilVector.add(boardWorldXAxis.clone().multiplyScalar(-recoilStrength));
            }

            const offsetDist = 0.15 + Math.random() * 0.1;
            sphere.position.add(boardWorldXAxis.clone().multiplyScalar(offsetDist));

            sphere.lookAt(sphere.position.clone().add(boardWorldXAxis));
            sphere.scale.set(
                PROJECTILE_SETTINGS.thicknessFactor, 
                PROJECTILE_SETTINGS.thicknessFactor, 
                PROJECTILE_SETTINGS.stretchFactor
            ); 

            this.projectiles.push({
                mesh: sphere,
                velocity: boardWorldXAxis.clone().multiplyScalar(
                    PROJECTILE_SETTINGS.speedBase + Math.random() * PROJECTILE_SETTINGS.speedRandom
                ),
                lifetime: 4,
                age: 0,
                isWhite: board.userData.isWhiteBoard
            });

            this.scene.add(sphere);
        }
    }

    processFiring(delta, board, xFollowActive) {
        if (!board || !xFollowActive) {
            if (board) board.userData.spawnTimer = 0;
            return;
        }

        if (board.userData.spawnTimer === undefined) board.userData.spawnTimer = 0;
        if (board.userData.nextSpawnDelay === undefined) board.userData.nextSpawnDelay = 0.2;
        if (board.userData.burstShotsRemaining === undefined) board.userData.burstShotsRemaining = 0;

        board.userData.spawnTimer += delta;
        if (board.userData.spawnTimer >= board.userData.nextSpawnDelay) {
            board.userData.spawnTimer = 0;

            if (board.userData.burstShotsRemaining <= 0) {
                board.userData.burstShotsRemaining = Math.floor(randomRange(10, 18));
            }

            this.spawnFromBoard(board, 1);
            board.userData.burstShotsRemaining--;

            if (board.userData.burstShotsRemaining > 0) {
                board.userData.nextSpawnDelay = this.burstFireRate;
            } else {
                board.userData.nextSpawnDelay = randomRange(this.betweenBurstDelayMin, this.betweenBurstDelayMax);
            }
        }
    }

    update(delta, board = null, xFollowActive = false) {
        if (board) {
            this.processFiring(delta, board, xFollowActive);
        }
        
        if (this.projectiles.length > 0) {
            this._updateSpatialGrid();
        }

        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const proj = this.projectiles[i];
            proj.age += delta;
            proj.mesh.position.add(proj.velocity.clone().multiplyScalar(delta));

            let destroyed = false;
            const gx = Math.floor(proj.mesh.position.x / this.gridCellSize);
            const gz = Math.floor(proj.mesh.position.z / this.gridCellSize);

            for (let x = gx - 1; x <= gx + 1 && !destroyed; x++) {
                for (let z = gz - 1; z <= gz + 1 && !destroyed; z++) {
                    const cell = this.spatialGrid.get(`${x},${z}`);
                    if (!cell) continue;

                    for (let j = cell.length - 1; j >= 0; j--) {
                        const cube = cell[j];
                        const distSq = proj.mesh.position.distanceToSquared(cube.position);
                        
                        if (distSq < 0.1225) {
                            if (proj.isWhite === cube.userData.isWhite) {
                                this._createExplosion(cube.position.clone());
                                this.checkerboardGroup.remove(cube);
                                
                                const masterCubes = this.checkerboardGroup.userData.cubes;
                                const idx = masterCubes.indexOf(cube);
                                if (idx !== -1) masterCubes.splice(idx, 1);

                                if (masterCubes.length === 0) {
                                    this._showWinMessage();
                                }

                                this.playImpact();
                            }

                            this.scene.remove(proj.mesh);
                            proj.mesh.material.dispose();
                            this.projectiles.splice(i, 1);
                            destroyed = true;
                            break;
                        }
                    }
                }
            }
            if (destroyed) continue;

            const fadeStart = proj.lifetime * 0.7;
            if (proj.age > fadeStart) {
                const fadeAlpha = 1 - (proj.age - fadeStart) / (proj.lifetime - fadeStart);
                proj.mesh.material.opacity = fadeAlpha;
                proj.mesh.material.transparent = true;
            }

            if (proj.age >= proj.lifetime) {
                this.scene.remove(proj.mesh);
                proj.mesh.material.dispose();
                this.projectiles.splice(i, 1);
            }
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.age += delta;
            p.mesh.position.add(p.velocity.clone().multiplyScalar(delta));
            
            const lifeRatio = p.age / p.lifetime;
            p.mesh.scale.setScalar(Math.max(0, 1 - lifeRatio));
            p.mesh.material.opacity = Math.max(0, 1 - lifeRatio);

            if (p.age >= p.lifetime) {
                this.scene.remove(p.mesh);
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
                this.particles.splice(i, 1);
            }
        }
    }
}

// =========================
// Board Queue & Curve Follower
// =========================

class BoardQueue {
    constructor(scene, templateBoard, queueOrigin, queueDirection, spacing = 0.5, initialCount = 4, startIndex = 0, preserveTexture = false) {
        this.scene = scene;

        this.templateBoard = templateBoard;
        // Ensure we capture the correct world orientation before detaching
        this.templateBoard.updateMatrixWorld(true);
        
        if (this.templateBoard.parent) {
            this.templateBoard.parent.remove(this.templateBoard);
        }

        this.queueOrigin = queueOrigin.clone();
        this.queueDirection = queueDirection.clone().normalize();
        this.spacing = spacing;
        this.preserveTexture = preserveTexture;

        this.blackMaterial = new THREE.MeshPhysicalMaterial({
            color: 0x080808, // Darkened to look almost black
            roughness: 0.4,
            metalness: 0.02
        });
        this.whiteMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xe6e6e6,
            metalness: 0.1,
            roughness: 0.3,
            clearcoat: 0.6,
            clearcoatRoughness: 0.12,
            envMapIntensity: 0.55
        });
        this.spawnCount = startIndex;

        this.boards = [];
        this.repositioning = false;
        this.repositionTime = 0;
        this.repositionDuration = 0.5; // Slower duration for better visibility
        this.repositionStart = [];
        this.repositionTarget = [];

        this.isPlate = this.templateBoard.name.toLowerCase().includes('plate');
        if (this.isPlate) {
            this.queueCounter = createShotCounter(initialCount, true);
            // Position it at the queue origin, slightly elevated above the surface
            this.queueCounter.mesh.position.copy(this.queueOrigin).add(new THREE.Vector3(0, 0.6, 0.4));
            this.scene.add(this.queueCounter.mesh);
        }

        // CHANGE THIS LINE FROM count TO initialCount:
        this._createInitialQueue(initialCount); 
    }

    _attachCounter(board) {
        const counter = createShotCounter(20);
        counter.mesh.name = 'shot_counter';
        board.add(counter.mesh);
        board.userData.shotsLeft = 20;
        board.userData.counter = counter;
    }

    _applyBoardMaterial(board, isWhite) {
        board.traverse(child => {
            if (child.isMesh && child.name !== 'raycast_collider' && child.name !== 'shot_counter') {
                if (!child.material || Array.isArray(child.material) || !child.material.color) {
                    return;
                }

                if (this.preserveTexture) {
                    child.material = child.material.clone();
                    if (isWhite) {
                        child.material.color.set(0xffffff); 
                        if (child.material.emissive) child.material.emissive.set(0x333333);
                    } else {
                        child.material.color.set(0x888888); 
                        if (child.material.emissive) child.material.emissive.set(0x000000);
                    }
                } else {
                    child.material = isWhite ? this.whiteMaterial : this.blackMaterial;
                }
            }
        });
    }

    _createInitialQueue(count) {
        for (let i = 0; i < count; i++) {
            const boardClone = this.templateBoard.clone(true);
            const offset = this.queueDirection.clone().multiplyScalar(this.spacing * i);
            const pos = this.queueOrigin.clone().add(offset);
            boardClone.position.copy(pos);
            boardClone.visible = true;

            if (this.isPlate) {
                boardClone.material = this.templateBoard.material;
            }

            if (!this.isPlate) {
                this._attachCounter(boardClone);
                const isWhite = (this.spawnCount % 2 === 0);
                boardClone.userData.isWhiteBoard = isWhite;
                this._applyBoardMaterial(boardClone, isWhite);
                this.spawnCount++;
            }

            this.scene.add(boardClone);
            this.boards.push(boardClone);
        }

        if (this.isPlate) {
            this.updateQueueCounters();
        }
    }

    getActiveBoard() {
        return this.boards[0] || null;
    }

    startReposition() {
        this.repositioning = false;

        this.repositionStart = [];
        this.repositionTarget = [];
        this.boards.forEach((board, index) => {
            this.repositionStart.push(board.position.clone());
            const target = this.queueOrigin.clone().add(
                this.queueDirection.clone().multiplyScalar(this.spacing * index)
            );
            this.repositionTarget.push(target);
            board.visible = true;
        });
        this.repositionTime = 0;
        this.repositioning = true;
    }

    updateQueueCounters() {
        const count = this.boards.length;
        if (this.isPlate && this.queueCounter) {
            this.queueCounter.update(count);
        }
    }

    update(delta) {
        if (!this.repositioning) return;

        this.repositionTime += delta;
        const t = Math.min(this.repositionTime / this.repositionDuration, 1);
        const ease = THREE.MathUtils.smoothstep(t, 0, 1);

        this.boards.forEach((board, index) => {
            board.position.lerpVectors(this.repositionStart[index], this.repositionTarget[index], ease);
        });

        if (t >= 1) {
            this.repositioning = false;
        }
    }

    finishAndRespawn(finishedBoard) {
        if (finishedBoard && finishedBoard.parent) {
            finishedBoard.parent.remove(finishedBoard);
        }
    }

    spawnNewBoardAtEnd(baseBoardDefaultQuaternion, baseBoardDefaultRotation) {
        const spawnOffset = this.queueDirection.clone().multiplyScalar(this.spacing * (this.boards.length + 1));
        const spawnPosition = this.queueOrigin.clone().add(spawnOffset);

        const newBoard = this.templateBoard.clone(true);
        newBoard.position.copy(spawnPosition);
        newBoard.quaternion.copy(baseBoardDefaultQuaternion);
        newBoard.rotation.copy(baseBoardDefaultRotation);
        newBoard.visible = true;

        if (this.isPlate) {
            newBoard.material = this.templateBoard.material;
        }

        if (!this.isPlate) {
            this._attachCounter(newBoard);
            const isWhite = (this.spawnCount % 2 === 0);
            newBoard.userData.isWhiteBoard = isWhite;
            this._applyBoardMaterial(newBoard, isWhite);
            this.spawnCount++;
        }

        this.scene.add(newBoard);
        this.boards.push(newBoard);
        
        this.startReposition();
        if (this.isPlate) this.updateQueueCounters();
    }
}

class CurveFollower {
    constructor(curve, boardQueue, projectileSystem, plateSystemRef = null) {
        this.curve = curve;
        this.boardQueue = boardQueue;
        this.projectileSystem = projectileSystem;
        this.plateSystemRef = plateSystemRef;
        this.isPlate = boardQueue.templateBoard.name.toLowerCase().includes('plate');

        this.boardSpeed = PATH_SPEED;
        this.boardJumpDuration = 0.4;
        this.boardJumpHeight = this.isPlate ? 0 : 0.8;

        this.boardReturnDuration = 0.7; 
        this.boardDyingDuration = 0.5;

        this.BOARD_X_FOLLOW_DELAY_MIN = COMBAT_STANCE_SETTINGS.delayMin;
        this.BOARD_X_FOLLOW_DELAY_MAX = COMBAT_STANCE_SETTINGS.delayMax;
        this.BOARD_X_FOLLOW_DUR_MIN = COMBAT_STANCE_SETTINGS.durationMin;
        this.BOARD_X_FOLLOW_DUR_MAX = COMBAT_STANCE_SETTINGS.durationMax;
        this.activePlate = null;
        this.plateReturning = false;
        this.plateReturnStartPos = new THREE.Vector3();
        this.plateReturnStartQuat = new THREE.Quaternion();
        this.plateReturnT = 0;

        this.activeMovingBoard = null;
        this.boardJumping = false;
        this.boardFollowing = false;
        this.boardDying = false;
        this.boardReturning = false;
        this.returningBoard = null;

        this.boardJumpStart = new THREE.Vector3();
        this.boardJumpEnd = new THREE.Vector3();
        this.boardJumpStartQuat = new THREE.Quaternion();

        this.boardXFollowActive = false;
        this.boardYFollowActive = false;
        this.previousBoardXFollowActive = false;
        this.previousBoardYFollowActive = false;

        this.wobbleRotation = 0;
        this.boardPathT = 0;
        this.pendingJumps = 0;

        this.plateLocalOffset = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

        this.plateJumpStartPos = new THREE.Vector3();
        this.plateJumpStartQuat = new THREE.Quaternion();
    }

    _startPlateReturn() {
        if (!this.activePlate || this.plateReturning) return;
        this.plateReturning = true;
        this.plateReturnStartPos.copy(this.activePlate.position);
        this.plateReturnStartQuat.copy(this.activePlate.quaternion);
        this.plateReturnT = 0;
    }

    _alignBoardY(board, t) {
        const position = this.curve.getPointAt(t);
        const nextT = Math.min(t + 0.05, 1);
        const nextPosition = this.curve.getPointAt(nextT);

        const direction = new THREE.Vector3().subVectors(nextPosition, position);
        direction.y = 0;
        direction.normalize();

        const angle = Math.atan2(direction.x, -direction.z);
        board.quaternion.setFromAxisAngle(new THREE.Vector3(0, -1, 0), angle);
    }

    _alignBoardX(board, t) {
        const position = this.curve.getPointAt(t);
        const nextT = Math.min(t + 0.01, 1);
        const nextPosition = this.curve.getPointAt(nextT);

        const direction = new THREE.Vector3().subVectors(nextPosition, position);
        direction.y = 0;
        if (direction.length() < 0.0001) return;
        direction.normalize();

        const angle = Math.atan2(direction.z, direction.x);
        board.quaternion.setFromAxisAngle(new THREE.Vector3(0, -1, 0), angle);
    }

    _alignBoardZ(board, t) {
        const position = this.curve.getPointAt(t);
        const nextT = Math.min(t + 0.01, 1);
        const nextPosition = this.curve.getPointAt(nextT);

        const direction = new THREE.Vector3().subVectors(nextPosition, position);
        direction.y = 0;
        if (direction.length() < 0.0001) return;
        direction.normalize();

        const angle = Math.atan2(direction.x, -direction.z);
        board.quaternion.setFromAxisAngle(new THREE.Vector3(0, -1, 0), angle);
    }

    _dispatchYFollowChange(active, t) {
        window.dispatchEvent(new CustomEvent(BOARD_Y_FOLLOW_CHANGE_EVENT, {
            detail: { active, t }
        }));
    }

    _dispatchXFollowChange(active, t) {
        window.dispatchEvent(new CustomEvent(BOARD_X_FOLLOW_CHANGE_EVENT, {
            detail: { active, t }
        }));
    }

    startJump(defQuat, defRot) {
        if (this.isPlate) return; 
        if (this.boardQueue.boards.length === 0) return;

        if (this.activeMovingBoard || this.boardJumping || this.boardFollowing || this.boardReturning || this.plateReturning) return;

        if (this.plateSystemRef && this.plateSystemRef.q.boards.length > 0) {
            this.activePlate = this.plateSystemRef.q.boards.shift();
            this.plateSystemRef.q.updateQueueCounters();
            this.plateSystemRef.q.startReposition();
            this.plateReturning = false;
            this.plateJumpStartPos.copy(this.activePlate.position);
            this.plateJumpStartQuat.copy(this.activePlate.quaternion);
        }

        this.projectileSystem.playSwoosh();

        const board = this.boardQueue.boards.shift();
        this.activeMovingBoard = board;
        
        if (this.isPlate) {
            this.boardQueue.updateQueueCounters();
            this.boardQueue.startReposition();
        } else {
            this.boardQueue.spawnNewBoardAtEnd(defQuat, defRot);
        }

        this.boardJumpStart.copy(this.activeMovingBoard.position);
        this.boardJumpEnd.copy(this.curve.getPointAt(0));
        this.boardJumpEnd.copy(this.curve.getPointAt(PATH_START_OFFSET));
        this.boardJumpT = 0;
        this.boardJumpStartQuat.copy(this.activeMovingBoard.quaternion);
        this.boardJumping = true;
        this.boardFollowing = false;

        this.boardXFollowActive = false;
        this.boardXFollowElapsed = 0;
        this.boardXFollowDuration = randomRange(this.BOARD_X_FOLLOW_DUR_MIN, this.BOARD_X_FOLLOW_DUR_MAX);
        this.boardXFollowTimer = randomRange(this.BOARD_X_FOLLOW_DELAY_MIN, this.BOARD_X_FOLLOW_DELAY_MAX);

        this.orientationLerp = 0;
        this.inCombatStance = false;
    }

    update(delta, baseBoardDefaultQuaternion, baseBoardDefaultRotation) {
        const startPadding = 0.4;
        const endPadding = 1.0;
        const canShoot = this.boardXFollowActive && 
                         this.boardXFollowElapsed > startPadding && 
                         this.boardXFollowElapsed < (this.boardXFollowDuration - endPadding);

        this.projectileSystem.update(delta, this.activeMovingBoard, canShoot);

        if (this.plateReturning && this.activePlate) {
            this.plateReturnT += delta / this.boardReturnDuration;
            const t = Math.min(this.plateReturnT, 1);
            const ease = THREE.MathUtils.smoothstep(t, 0, 1);
            
            const q = this.plateSystemRef.q;
            const targetPos = q.queueOrigin.clone().add(q.queueDirection.clone().multiplyScalar(q.spacing * q.boards.length));

            this.activePlate.position.lerpVectors(this.plateReturnStartPos, targetPos, ease);
            this.activePlate.quaternion.slerpQuaternions(this.plateReturnStartQuat, this.plateSystemRef.defQuat, ease);
            this.activePlate.position.y += Math.sin(ease * Math.PI) * this.boardJumpHeight;

            if (t >= 1) {
                this.plateReturning = false;
                q.boards.push(this.activePlate);
                q.startReposition();
                q.updateQueueCounters();
                this.activePlate = null;
            }
        }

        if (!this.activeMovingBoard) return;

        const activeBoard = this.activeMovingBoard;

        if (activeBoard && activeBoard.userData.shotsLeft === 0 && !this.boardDying && (this.boardFollowing || this.boardJumping)) {
            this.boardDying = true;
            this.boardDyingT = 0;
            this.boardXFollowActive = false;
            this.boardYFollowActive = false;
            this.projectileSystem.setActive(false);
            this._startPlateReturn();
        }

        if (this.boardDying) {
            this.boardDyingT += delta / this.boardDyingDuration;
            const scaleFactor = Math.max(0, 1 - this.boardDyingT);
            activeBoard.scale.setScalar(scaleFactor);

            if (this.boardDyingT >= 1) {
                this.boardDying = false;
                this.boardFollowing = false;
                this.boardJumping = false;
                activeBoard.visible = false;
                activeBoard.scale.setScalar(1); 

                this.boardQueue.finishAndRespawn(activeBoard);
                this.activeMovingBoard = null;
                this.boardXFollowActive = false;
                this.boardYFollowActive = false;
                this.previousBoardXFollowActive = false;
                this.previousBoardYFollowActive = false;
                this.projectileSystem.setActive(false);
            }
        }

        if (this.boardJumping && activeBoard) {
            this.boardJumpT += delta / this.boardJumpDuration;
            const t = Math.min(this.boardJumpT, 1);
            const ease = THREE.MathUtils.smoothstep(t, 0, 1);

            activeBoard.position.lerpVectors(this.boardJumpStart, this.boardJumpEnd, ease);
            activeBoard.position.y += Math.sin(ease * Math.PI) * this.boardJumpHeight;

            if (this.activePlate && !this.plateReturning) {
                this.activePlate.position.lerpVectors(this.plateJumpStartPos, this.boardJumpEnd, ease);
                const plateTargetQuat = new THREE.Quaternion();
                const dummy = new THREE.Object3D();
                this._alignBoardY(dummy, PATH_START_OFFSET);
                plateTargetQuat.copy(dummy.quaternion).multiply(this.plateLocalOffset);
                this.activePlate.quaternion.slerpQuaternions(this.plateJumpStartQuat, plateTargetQuat, ease);
            }

            if (activeBoard.userData.recoilVector) {
                activeBoard.position.add(activeBoard.userData.recoilVector);
                activeBoard.userData.recoilVector.multiplyScalar(Math.max(0, 1 - delta * 15));
            }

            const targetQuat = new THREE.Quaternion();
            const pos0 = this.curve.getPointAt(PATH_START_OFFSET);
            const pos1 = this.curve.getPointAt(PATH_START_OFFSET + 0.01);
            const dir = new THREE.Vector3().subVectors(pos1, pos0).setY(0);
            
            if (dir.length() > 0.0001) {
                dir.normalize();
                const angle = Math.atan2(dir.x, -dir.z);
                targetQuat.setFromAxisAngle(new THREE.Vector3(0, -1, 0), angle);
                activeBoard.quaternion.slerpQuaternions(this.boardJumpStartQuat, targetQuat, ease);
            }

            if (t >= 1) {
                this.boardJumping = false;
                this.boardFollowing = true;
                this.boardPathT = PATH_START_OFFSET;
                activeBoard.position.copy(this.boardJumpEnd);
                this._alignBoardY(activeBoard, PATH_START_OFFSET);
            }
        } else if (this.boardFollowing && activeBoard) {
            this.boardPathT += this.boardSpeed * delta;

            if (this.boardPathT >= 1) {
                this.boardPathT = 1;
                this.boardFollowing = false;

                this._startPlateReturn();
                activeBoard.visible = false;
                this.boardQueue.finishAndRespawn(activeBoard);
                this.activeMovingBoard = null;

                this.boardXFollowActive = false;
                this.boardYFollowActive = false;
                this.previousBoardXFollowActive = false;
                this.previousBoardYFollowActive = false;
                this.projectileSystem.setActive(false);
                return;
            }

            const targetPosition = this.curve.getPointAt(this.boardPathT);
            activeBoard.position.copy(targetPosition);

            if (this.activePlate && !this.plateReturning) {
                this.activePlate.position.copy(activeBoard.position);
                const dummy = new THREE.Object3D();
                this._alignBoardY(dummy, this.boardPathT);
                this.activePlate.quaternion.copy(dummy.quaternion).multiply(this.plateLocalOffset);
            }

            if (activeBoard.userData.recoilVector) {
                activeBoard.position.add(activeBoard.userData.recoilVector);
                activeBoard.userData.recoilVector.multiplyScalar(Math.max(0, 1 - delta * 15));
            }

            if (!this.boardXFollowActive) {
                this.boardXFollowTimer -= delta;
                if (this.boardXFollowTimer <= 0) {
                    this.boardXFollowActive = true;
                    this.boardXFollowElapsed = 0;
                    this.boardXFollowDuration = randomRange(
                        this.BOARD_X_FOLLOW_DUR_MIN,
                        this.BOARD_X_FOLLOW_DUR_MAX
                    );
                }
            } else {
                this.boardXFollowElapsed += delta;
                if (this.boardXFollowElapsed >= this.boardXFollowDuration) {
                    this.boardXFollowActive = false;
                    this.boardXFollowTimer = randomRange(
                        this.BOARD_X_FOLLOW_DELAY_MIN,
                        this.BOARD_X_FOLLOW_DELAY_MAX
                    );
                }
            }

            const boardYFollowNow = !this.boardXFollowActive;
            if (boardYFollowNow !== this.boardYFollowActive) {
                this.boardYFollowActive = boardYFollowNow;
                if (this.boardYFollowActive !== this.previousBoardYFollowActive) {
                    this._dispatchYFollowChange(this.boardYFollowActive, this.boardPathT);
                    this.previousBoardYFollowActive = this.boardYFollowActive;
                }
            }

            if (this.boardXFollowActive !== this.previousBoardXFollowActive) {
                this._dispatchXFollowChange(this.boardXFollowActive, this.boardPathT);
                this.previousBoardXFollowActive = this.boardXFollowActive;
            }

        }

        if (activeBoard && !this.boardJumping) {
            if (this.boardXFollowActive || this.boardDying) {
                this.inCombatStance = true;
            }
            
            const targetLerp = this.inCombatStance ? 1 : 0;
            this.orientationLerp = THREE.MathUtils.lerp(this.orientationLerp, targetLerp, delta * 12);

            const quatDefault = new THREE.Quaternion();
            const quatFiring = new THREE.Quaternion();
            const dummy = new THREE.Object3D();

            this._alignBoardY(dummy, this.boardPathT);
            quatDefault.copy(dummy.quaternion);
            this._alignBoardX(dummy, this.boardPathT);
            quatFiring.copy(dummy.quaternion);

            activeBoard.quaternion.slerpQuaternions(quatDefault, quatFiring, this.orientationLerp);

            const currentWobbleMax = this.boardXFollowActive ? 1.2 : 0.05;
            this.wobbleRotation = THREE.MathUtils.lerp(this.wobbleRotation, (Math.random() - 0.5) * currentWobbleMax, delta * 2);
            activeBoard.rotateY(this.wobbleRotation);
        }
    }
}

// =========================
// Arrow Indicator
// =========================

class ArrowIndicator {
    constructor(scene, curve, texture, count = ARROW_SETTINGS.count) {
        this.scene = scene;
        this.curve = curve;
        this.tOffset = 0;
        this.speed = PATH_SPEED;
        this.count = count;
        this.baseOpacity = ARROW_SETTINGS.baseOpacity;
        this.fadeZone = ARROW_SETTINGS.fadeZone;

        const geometry = new THREE.PlaneGeometry(0.2, 0.2);

        this.arrows = [];
        for (let i = 0; i < count; i++) {
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uColor: { value: new THREE.Color(ARROW_SETTINGS.color) },
                    uTexture: { value: texture },
                    uOpacity: { value: 0.0 }
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform vec3 uColor;
                    uniform sampler2D uTexture;
                    uniform float uOpacity;
                    varying vec2 vUv;
                    void main() {
                        vec4 texColor = texture2D(uTexture, vUv);
                        gl_FragColor = vec4(uColor, texColor.a * uOpacity);
                    }
                `,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(geometry, material);
            this.scene.add(mesh);
            this.arrows.push(mesh);
        }
    }

    update(delta) {
        this.tOffset = (this.tOffset + delta * this.speed) % 1;

        for (let i = 0; i < this.count; i++) {
            const t = (this.tOffset + i / this.count) % 1;
            const mesh = this.arrows[i];

            let opacity = this.baseOpacity;
            if (t < this.fadeZone) {
                opacity = (t / this.fadeZone) * this.baseOpacity;
            } else if (t > 1 - this.fadeZone) {
                opacity = ((1 - t) / this.fadeZone) * this.baseOpacity;
            }
            mesh.material.uniforms.uOpacity.value = opacity;

            const pos = this.curve.getPointAt(t);
            mesh.position.copy(pos);
            mesh.position.y += 0.01; 

            const lookTarget = this.curve.getPointAt((t + 0.01) % 1);
            mesh.lookAt(lookTarget);
            mesh.rotateX(Math.PI / 2); 
        }
    }
}

// =========================
// Input Controller (mouse + hand)
// =========================

class InputController {
    constructor(sceneManager, handRef) {
        this.sceneManager = sceneManager;
        this.hand = handRef;
        this.handY = handRef ? handRef.position.y : 0;

        this.pointer = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();
        this.horizontalPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        this.handTarget = new THREE.Vector3();

        window.addEventListener('mousemove', (e) => this._onPointerMove(e));
    }

    updatePointerFromEvent(event) {
        const rect = this.sceneManager.canvas.getBoundingClientRect();
        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    _onPointerMove(event) {
        this.updatePointerFromEvent(event);

        if (this.hand) {
            this.raycaster.setFromCamera(this.pointer, this.sceneManager.camera);
            this.raycaster.ray.intersectPlane(this.horizontalPlane, this.handTarget);
            this.hand.position.set(this.handTarget.x, this.handY, this.handTarget.z);
        }
    }
}

// =========================
// GLTF Loader & bootstrap
// =========================

function initExperience(points) {
    const sceneManager = new SceneManager('expirience-canvas');

    const curve = createCurve(points);

    const checkerboardGroup = spawnCheckerboard(sceneManager.scene);

    const loader = new GLTFLoader();

    loader.load('GameObjects/FishTank.glb', (glb) => {
        console.log('Main model loaded successfully.');
        let boardBase = null;
        let plateBase = null;
        let fishBase = null;
        let hand = null;
        const waterObjects = [];
        const worldOrigin = new THREE.Vector3();
        const boardBaseDefaultQuaternion = new THREE.Quaternion();
        const boardBaseDefaultRotation = new THREE.Euler();
        let boardBaseDefaultSaved = false;
        const fishBaseDefaultQuaternion = new THREE.Quaternion();
        const fishBaseDefaultRotation = new THREE.Euler();
        let fishBaseDefaultSaved = false;
        const fishWorldOrigin = new THREE.Vector3();
        const plateWorldOrigin = new THREE.Vector3();
        const plateBaseDefaultQuaternion = new THREE.Quaternion();
        const plateBaseDefaultRotation = new THREE.Euler();
        let plateBaseDefaultSaved = false;

        glb.scene.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }

            // --- STYLIZED CODROPS WATER SHADER APPLIED ON FLOOR OBJECT ---
            if (child.isMesh && (child.name === 'Floor' || child.name.toLowerCase().includes('floor'))) {
                const stylizedWaterMaterial = new THREE.ShaderMaterial({
                    uniforms: {
                        time: { value: 0.0 },
                        uColorShallow: { value: new THREE.Color(0x2ce2ff) }, // Bright turquoise depth color
                        uColorDeep: { value: new THREE.Color(0x0a5175) },    // Deep ocean base gradient
                        uColorFoam: { value: new THREE.Color(0xffffff) }     // Vibrant cell-shaded white foam lines
                    },
                    vertexShader: `
                        varying vec2 vUv;
                        varying vec3 vPosition;
                        void main() {
                            vUv = uv;
                            vPosition = position;
                            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                        }
                    `,
                    fragmentShader: `
                        uniform float time;
                        uniform vec3 uColorShallow;
                        uniform vec3 uColorDeep;
                        uniform vec3 uColorFoam;
                        varying vec2 vUv;
                        varying vec3 vPosition;

                        // Procedural 2D Noise function for zero texture load dependencies
                        float hash(vec2 p) {
                            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
                        }
                        float noise(vec2 p) {
                            vec2 i = floor(p);
                            vec2 f = fract(p);
                            vec2 u = f * f * (3.0 - 2.0 * f);
                            return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
                                       mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
                        }

                        void main() {
                            // Scale up and animate multi-directional vectors for moving current ripples
                            vec2 uv1 = vUv * 6.5 + vec2(time * 0.04, time * 0.03);
                            vec2 uv2 = vUv * 11.0 - vec2(time * 0.02, time * -0.03);

                            float n1 = noise(uv1);
                            float n2 = noise(uv2);
                            float combinedNoise = (n1 + n2) * 0.5;

                            // Calculate stylized water baseline gradient mapping
                            vec3 waterColor = mix(uColorDeep, uColorShallow, combinedNoise);

                            // Create sharp cell-shaded stylized wave foam thresholds 
                            float foamCutoff = 0.9;
                            float foamWidth = 0.03;
                            float foamEdge = smoothstep(foamCutoff, foamCutoff + foamWidth, combinedNoise);
                            
                            // Fine secondary interior ripples
                            float rippleEdge = smoothstep(0.40, 0.42, combinedNoise) * smoothstep(0.45, 0.43, combinedNoise);

                            vec3 finalColor = mix(waterColor, uColorFoam, foamEdge);
                            finalColor += rippleEdge * uColorFoam * 0.35; // Overlay ambient secondary waves

                            gl_FragColor = vec4(finalColor, 0.9);
                        }
                    `,
                    transparent: true,
                    side: THREE.DoubleSide
                });

                // Directly swap material to enforce styling changes safely on the loaded asset
                child.material = stylizedWaterMaterial;
                child.visible = true; 

                // Track mesh directly in update loop to step forward shader timelines safely
                waterObjects.push(child); 
            }

            if (!boardBaseDefaultSaved && (child.name === 'Board' || child.name.toLowerCase().includes('board'))) {
                boardBase = child;
                boardBaseDefaultQuaternion.copy(boardBase.quaternion);
                boardBaseDefaultRotation.copy(boardBase.rotation);
                boardBaseDefaultSaved = true;
            }

            if (!fishBaseDefaultSaved && (child.name === 'Fish' || child.name.toLowerCase().includes('fish'))) {
                fishBase = child;
                fishBaseDefaultQuaternion.copy(fishBase.quaternion);
                fishBaseDefaultRotation.copy(fishBase.rotation);
                fishBaseDefaultSaved = true;
            }

            // --- PLATE DIRECTIONAL WAVE SHADER ---
            if (!plateBaseDefaultSaved && (child.name === 'Plate' || child.name.toLowerCase().includes('plate'))) {
                plateBase = child;
                plateBaseDefaultQuaternion.copy(plateBase.quaternion);
                plateBaseDefaultRotation.copy(plateBase.rotation);
                plateBaseDefaultSaved = true;

                const plateWaveMaterial = new THREE.ShaderMaterial({
                    uniforms: {
                        time: { value: 0.0 },
                        uColorShallow: { value: new THREE.Color(0x2ce2ff) }, 
                        uColorDeep: { value: new THREE.Color(0x0a5175) },    
                        uColorFoam: { value: new THREE.Color(0xffffff) },     
                        uDirection: { value: new THREE.Vector2(1.0, 0.0) } // Direction of waves
                    },
                    vertexShader: `
                        varying vec2 vUv;
                        varying vec3 vPosition;
                        void main() {
                            vUv = uv;
                            vPosition = position;
                            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                        }
                    `,
                    fragmentShader: `
                        uniform float time;
                        uniform vec3 uColorShallow;
                        uniform vec3 uColorDeep;
                        uniform vec3 uColorFoam;
                        uniform vec2 uDirection;
                        varying vec2 vUv;
                        varying vec3 vPosition;

                        // Procedural 2D Noise function
                        float hash(vec2 p) {
                            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
                        }
                        float noise(vec2 p) {
                            vec2 i = floor(p);
                            vec2 f = fract(p);
                            vec2 u = f * f * (3.0 - 2.0 * f);
                            return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
                                       mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
                        }

                        void main() {
                            // Directional wave movement
                            vec2 waveDir = normalize(uDirection);
                            float waveSpeed = 0.5;
                            
                            // Moving UVs along direction
                            vec2 uv1 = vUv * 5.0 - waveDir * time * waveSpeed;
                            vec2 uv2 = vUv * 8.0 - waveDir * time * waveSpeed * 1.5;
                            
                            // Distort slightly perpendicular to direction for organic feel
                            vec2 perpDir = vec2(-waveDir.y, waveDir.x);
                            uv1 += perpDir * noise(vUv * 4.0 + time * 0.2) * 0.2;
                            
                            float n1 = noise(uv1);
                            float n2 = noise(uv2);
                            float combinedNoise = (n1 + n2) * 0.5;
                            
                            // Create repeating wave lines
                            float wave = sin((dot(vUv, waveDir) * 20.0 - time * -2.0) + combinedNoise * 2.0) * 0.5 + 0.5;

                            // Calculate stylized water baseline gradient mapping
                            vec3 waterColor = mix(uColorDeep, uColorShallow, wave);

                            // Create sharp cell-shaded stylized wave foam thresholds 
                            float foamCutoff = 0.8;
                            float foamWidth = 0.05;
                            float foamEdge = smoothstep(foamCutoff, foamCutoff + foamWidth, wave);

                            vec3 finalColor = mix(waterColor, uColorFoam, foamEdge);

                            // Adjust this alpha value (0.0 to 1.0) for more/less transparency
                            gl_FragColor = vec4(finalColor, 0.5);
                        }
                    `,
                    transparent: true,
                    side: THREE.DoubleSide
                });

                child.material = plateWaveMaterial;
                waterObjects.push(child);
            }


            if (child.isMesh && (child.name === 'Hand' || child.name.toLowerCase().includes('hand'))) {
                hand = child;
            }

            // --- STREAM BELT WATER SHADER ---
            // --- STREAM BELT WATER SHADER ---
if (child.isMesh && (child.name === 'StreamBelt' || child.name.toLowerCase().includes('streambelt'))) {
    const water = new Water(
        child.geometry,
        {
            textureWidth: 512,
            textureHeight: 512,
            waterNormals: new THREE.TextureLoader().load('GameObjects/waternormals.jpg', (texture) => {
                texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            }),
            sunDirection: sceneManager.sun.position.clone().normalize(),
            sunColor: 0xffffff,
            waterColor: 0x99e5ff, 
            distortionScale: 7.0, 
            fog: sceneManager.scene.fog !== undefined,
            alpha: 0.6, 
            side: THREE.DoubleSide
        }
    );
    
    water.material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
            'varying vec4 worldPosition;',
            'varying vec4 worldPosition;\nvarying vec2 vUv;' // <-- Removed duplicate 'attribute vec2 uv;'
        );
        shader.vertexShader = shader.vertexShader.replace(
            'void main() {',
            'void main() {\nvUv = uv;'
        );
        
        shader.fragmentShader = shader.fragmentShader.replace(
            'varying vec4 worldPosition;',
            'varying vec4 worldPosition;\nvarying vec2 vUv;'
        );
        
        shader.fragmentShader = shader.fragmentShader.replace(
            'vec4 noise = getNoise( worldPosition.xz * size );',
            'vec4 noise = getNoise( vUv * size );'
        );

        shader.fragmentShader = shader.fragmentShader.replace(/uv \/ 103\.0/g, 'uv * -0.1');
        shader.fragmentShader = shader.fragmentShader.replace(/uv \/ 107\.0/g, 'uv * -0.1');
    };

    water.material.transparent = true;
    water.frustumCulled = false; 
    water.material.uniforms[ 'size' ].value = 4.0;
    
    child.updateMatrixWorld(true);
    child.matrixWorld.decompose(water.position, water.quaternion, water.scale);

    water.position.y += 0.005;

    sceneManager.scene.add(water);
    waterObjects.push(water);
    child.visible = false; 
}
        });

        if (!boardBase) {
            boardBase = glb.scene;
            boardBaseDefaultQuaternion.copy(boardBase.quaternion);
            boardBaseDefaultRotation.copy(boardBase.rotation);
        }

        {
            glb.scene.updateMatrixWorld(true);
            const aabb = new THREE.Box3().setFromObject(boardBase);
            const size = new THREE.Vector3();
            aabb.getSize(size);
            const center = new THREE.Vector3();
            aabb.getCenter(center);

            const hitboxHeight = 0.4;
            const hitboxGeom = new THREE.BoxGeometry(
                size.x * 1.8, 
                hitboxHeight, 
                Math.min(size.z * 1.1, 0.4)
            );

            const hitboxMat = new THREE.MeshBasicMaterial({ 
                color: 0x00ff00,
                wireframe: true,
                transparent: true, 
                opacity: 0, 
                depthWrite: false 
            });
            const hitbox = new THREE.Mesh(hitboxGeom, hitboxMat);
            hitbox.name = 'raycast_collider';

            boardBase.worldToLocal(center);
            hitbox.position.copy(center);
            boardBase.add(hitbox);

            applyOutline(boardBase, 0.012);

            boardBase.traverse(c => {
                if (c.isMesh) {
                    c.geometry.computeBoundingBox();
                    c.geometry.computeBoundingSphere();
                }
            });

            boardBase.updateMatrixWorld(true);
            boardBase.getWorldPosition(worldOrigin);

            if (boardBase && boardBase.parent) {
                boardBase.parent.remove(boardBase);
            }
        }
        
        if (fishBase) {
            {
            glb.scene.updateMatrixWorld(true);
            const aabb = new THREE.Box3().setFromObject(fishBase);
            const size = new THREE.Vector3();
            aabb.getSize(size);
            const center = new THREE.Vector3();
            aabb.getCenter(center);

            const hitboxHeight = 0.4;
            const hitboxGeom = new THREE.BoxGeometry(
                size.x * 1.8, 
                hitboxHeight, 
                Math.min(size.z * 1.1, 0.4)
            );

            const hitboxMat = new THREE.MeshBasicMaterial({ 
                color: 0x00ff00,
                wireframe: true,
                transparent: true, 
                opacity: 0, 
                depthWrite: false 
            });
            const hitbox = new THREE.Mesh(hitboxGeom, hitboxMat);
            hitbox.name = 'raycast_collider';

            fishBase.worldToLocal(center);
            hitbox.position.copy(center);
            fishBase.add(hitbox);

            applyOutline(fishBase, 0.01);

            fishBase.traverse(c => {
                if (c.isMesh) {
                    c.geometry.computeBoundingBox();
                    c.geometry.computeBoundingSphere();
                }
            });

            fishBase.updateMatrixWorld(true);
            fishBase.getWorldPosition(fishWorldOrigin);

            if (fishBase && fishBase.parent) {
                fishBase.parent.remove(fishBase);
            }
            }
        }

        if (plateBase) {
            {
            glb.scene.updateMatrixWorld(true);
            const aabb = new THREE.Box3().setFromObject(plateBase);
            const size = new THREE.Vector3();
            aabb.getSize(size);
            const center = new THREE.Vector3();
            aabb.getCenter(center);

            const hitboxHeight = 0.4;
            const hitboxGeom = new THREE.BoxGeometry(
                size.x * 1.8, 
                hitboxHeight, 
                Math.min(size.z * 1.1, 0.4)
            );

            const hitboxMat = new THREE.MeshBasicMaterial({ 
                color: 0x00ff00,
                wireframe: true,
                transparent: true, 
                opacity: 0, 
                depthWrite: false 
            });
            const hitbox = new THREE.Mesh(hitboxGeom, hitboxMat);
            hitbox.name = 'raycast_collider';

            plateBase.worldToLocal(center);
            hitbox.position.copy(center);
            plateBase.add(hitbox);

            plateBase.traverse(c => {
                if (c.isMesh) {
                    c.geometry.computeBoundingBox();
                    c.geometry.computeBoundingSphere();
                }
            });

            plateBase.updateMatrixWorld(true);
            plateBase.getWorldPosition(plateWorldOrigin);

            if (plateBase.parent) plateBase.parent.remove(plateBase);
            }
        }

        sceneManager.scene.add(glb.scene);

        const queueOrigin = worldOrigin;
        const queueDirection = new THREE.Vector3(0, 0, 1);
        const plateQueueDirection = new THREE.Vector3(0, 1, 0);
        
        const gameSystems = [];
        const interQueueSpacing = 0.42;

        let plateSystem = null;
        if (plateBase) {
            const q = new BoardQueue(
                sceneManager.scene,
                plateBase,
                plateWorldOrigin,
                plateQueueDirection,
                0.05,
                5, 
                0
            );
            const ps = new ProjectileSystem(sceneManager.scene, checkerboardGroup, sceneManager.audioListener);
            const cf = new CurveFollower(curve, q, ps);
            plateSystem = { q, ps, f: cf, defQuat: plateBaseDefaultQuaternion, defRot: plateBaseDefaultRotation };
            gameSystems.push(plateSystem);
        }

        if (fishBase) {
            const fishQueueOrigin = fishWorldOrigin;
            for (let i = 0; i < 4; i++) {
                const q = new BoardQueue(
                    sceneManager.scene,
                    fishBase,
                    fishQueueOrigin.clone().add(new THREE.Vector3(interQueueSpacing * i, 0, 0)),
                    queueDirection,
                    0.5,
                    3,
                    i % 2, 
                    false        
                );
                const ps = new ProjectileSystem(sceneManager.scene, checkerboardGroup, sceneManager.audioListener);
                const cf = new CurveFollower(curve, q, ps, plateSystem);
                gameSystems.push({ q, ps, f: cf, defQuat: fishBaseDefaultQuaternion, defRot: fishBaseDefaultRotation });
            }
        }

        const textureLoader = new THREE.TextureLoader();
        const arrowTexture = textureLoader.load('/GameObjects/arrow.png');
        const arrowIndicator = new ArrowIndicator(sceneManager.scene, curve, arrowTexture, ARROW_SETTINGS.count);

        const inputController = new InputController(sceneManager, hand);

        sceneManager.canvas.addEventListener('click', (event) => {
            if (event.button !== 0) return;

            if (sceneManager.audioListener.context.state === 'suspended') {
                sceneManager.audioListener.context.resume();
            }

            inputController.updatePointerFromEvent(event);

            sceneManager.scene.updateMatrixWorld(true);
            inputController.raycaster.setFromCamera(inputController.pointer, sceneManager.camera);
            
            const allBoards = gameSystems.flatMap(sys => sys.q.boards);

            const intersects = inputController.raycaster.intersectObjects(allBoards, true);
            
            if (intersects.length > 0) {
                const topObject = intersects[0].object;

                for (const sys of gameSystems) {
                    const activeBoard = sys.q.getActiveBoard();
                    if (!activeBoard) continue;

                    let isPartOfActive = (topObject === activeBoard);
                    topObject.traverseAncestors(a => { if (a === activeBoard) isPartOfActive = true; });

                    if (isPartOfActive) {
                        sys.f.startJump(sys.defQuat, sys.defRot);
                        break; 
                    }
                }
            }
        });

        function animate(timestamp) {
            const delta = sceneManager.getDelta(timestamp);
            waterObjects.forEach(w => {
                w.material.uniforms['time'].value += delta;
            });
            gameSystems.forEach(sys => {
                sys.q.update(delta);
                sys.f.update(delta, sys.defQuat, sys.defRot);
            });
            arrowIndicator.update(delta);
            sceneManager.render();
            requestAnimationFrame(animate);
        }

        animate();
    }, undefined, (error) => {
        console.error('CRITICAL ERROR: Could not load FishTank.glb', error);
    });
}

// =========================
// Usage: path nodes data
// =========================

const points = [
new THREE.Vector3(-0.7087, -0.0274, 0.4898),
new THREE.Vector3(-0.7127, -0.0214, 0.4898),
new THREE.Vector3(-0.7183, -0.0130, 0.4898),
new THREE.Vector3(-0.7249, -0.0025, 0.4898),
new THREE.Vector3(-0.7317, 0.0097, 0.4898),
new THREE.Vector3(-0.7382, 0.0232, 0.4898),
new THREE.Vector3(-0.7435, 0.0376, 0.4898),
new THREE.Vector3(-0.7471, 0.0527, 0.4898),
new THREE.Vector3(-0.7482, 0.0680, 0.4898),
new THREE.Vector3(-0.7462, 0.0831, 0.4898),
new THREE.Vector3(-0.7414, 0.0977, 0.4898),
new THREE.Vector3(-0.7346, 0.1114, 0.4898),
new THREE.Vector3(-0.7263, 0.1240, 0.4898),
new THREE.Vector3(-0.7165, 0.1353, 0.4898),
new THREE.Vector3(-0.7056, 0.1450, 0.4898),
new THREE.Vector3(-0.6939, 0.1529, 0.4898),
new THREE.Vector3(-0.6816, 0.1589, 0.4898),
new THREE.Vector3(-0.6690, 0.1626, 0.4898),
new THREE.Vector3(-0.6563, 0.1639, 0.4898),
new THREE.Vector3(-0.6179, 0.1639, 0.4898),
new THREE.Vector3(-0.5924, 0.1639, 0.4898),
new THREE.Vector3(-0.5761, 0.1639, 0.4898),
new THREE.Vector3(-0.5654, 0.1639, 0.4898),
new THREE.Vector3(-0.5567, 0.1639, 0.4898),
new THREE.Vector3(-0.5461, 0.1639, 0.4898),
new THREE.Vector3(-0.5300, 0.1639, 0.4898),
new THREE.Vector3(-0.5047, 0.1639, 0.4898),
new THREE.Vector3(-0.4665, 0.1639, 0.4898),
new THREE.Vector3(-0.4217, 0.1639, 0.4898),
new THREE.Vector3(-0.3767, 0.1639, 0.4898),
new THREE.Vector3(-0.3277, 0.1639, 0.4898),
new THREE.Vector3(-0.2709, 0.1639, 0.4898),
new THREE.Vector3(-0.2025, 0.1639, 0.4898),
new THREE.Vector3(-0.1188, 0.1639, 0.4898),
new THREE.Vector3(-0.0161, 0.1639, 0.4898),
new THREE.Vector3(0.1094, 0.1639, 0.4898),
new THREE.Vector3(0.2616, 0.1639, 0.4898),
new THREE.Vector3(0.4178, 0.1639, 0.4904),
new THREE.Vector3(0.5542, 0.1639, 0.4914),
new THREE.Vector3(0.6719, 0.1639, 0.4911),
new THREE.Vector3(0.7725, 0.1639, 0.4882),
new THREE.Vector3(0.8571, 0.1639, 0.4813),
new THREE.Vector3(0.9272, 0.1639, 0.4688),
new THREE.Vector3(0.9841, 0.1639, 0.4494),
new THREE.Vector3(1.0291, 0.1639, 0.4216),
new THREE.Vector3(1.0636, 0.1639, 0.3839),
new THREE.Vector3(1.0884, 0.1639, 0.3350),
new THREE.Vector3(1.1044, 0.1639, 0.2741),
new THREE.Vector3(1.1132, 0.1639, 0.2009),
new THREE.Vector3(1.1164, 0.1639, 0.1146),
new THREE.Vector3(1.1155, 0.1639, 0.0150),
new THREE.Vector3(1.1120, 0.1639, -0.0987),
new THREE.Vector3(1.1076, 0.1639, -0.2269),
new THREE.Vector3(1.1039, 0.1639, -0.3701),
new THREE.Vector3(1.1022, 0.1639, -0.5288),
new THREE.Vector3(1.1012, 0.1639, -0.5888),
new THREE.Vector3(1.0983, 0.1639, -0.6524),
new THREE.Vector3(1.0942, 0.1639, -0.7255),
new THREE.Vector3(1.0893, 0.1639, -0.8143),
new THREE.Vector3(1.0841, 0.1639, -0.9251),
new THREE.Vector3(1.0792, 0.1639, -1.0639),
new THREE.Vector3(1.0751, 0.1639, -1.2369),
new THREE.Vector3(1.0722, 0.1639, -1.4502),
new THREE.Vector3(1.0711, 0.1639, -1.7100),
new THREE.Vector3(1.0716, 0.1639, -1.7447),
new THREE.Vector3(1.0705, 0.1639, -1.7863),
new THREE.Vector3(1.0643, 0.1639, -1.8321),
new THREE.Vector3(1.0493, 0.1639, -1.8789),
new THREE.Vector3(1.0217, 0.1639, -1.9238),
new THREE.Vector3(0.9781, 0.1639, -1.9639),
new THREE.Vector3(0.9147, 0.1639, -1.9962),
new THREE.Vector3(0.8280, 0.1639, -2.0178),
new THREE.Vector3(0.7141, 0.1639, -2.0256),
new THREE.Vector3(0.6324, 0.1639, -2.0256),
new THREE.Vector3(0.5467, 0.1639, -2.0256),
new THREE.Vector3(0.4555, 0.1639, -2.0256),
new THREE.Vector3(0.3572, 0.1639, -2.0256),
new THREE.Vector3(0.2501, 0.1639, -2.0256),
new THREE.Vector3(0.1326, 0.1639, -2.0256),
new THREE.Vector3(0.0030, 0.1639, -2.0256),
new THREE.Vector3(-0.1402, 0.1639, -2.0256),
new THREE.Vector3(-0.2986, 0.1639, -2.0256),
new THREE.Vector3(-0.3300, 0.1639, -2.0256),
new THREE.Vector3(-0.3640, 0.1639, -2.0256),
new THREE.Vector3(-0.4016, 0.1639, -2.0256),
new THREE.Vector3(-0.4432, 0.1639, -2.0256),
new THREE.Vector3(-0.4898, 0.1639, -2.0256),
new THREE.Vector3(-0.5419, 0.1639, -2.0256),
new THREE.Vector3(-0.6003, 0.1639, -2.0256),
new THREE.Vector3(-0.6656, 0.1639, -2.0256),
new THREE.Vector3(-0.7386, 0.1639, -2.0256),
new THREE.Vector3(-0.8543, 0.1639, -2.0162),
new THREE.Vector3(-0.9451, 0.1639, -1.9902),
new THREE.Vector3(-1.0140, 0.1639, -1.9511),
new THREE.Vector3(-1.0641, 0.1639, -1.9024),
new THREE.Vector3(-1.0982, 0.1639, -1.8474),
new THREE.Vector3(-1.1195, 0.1639, -1.7897),
new THREE.Vector3(-1.1310, 0.1639, -1.7326),
new THREE.Vector3(-1.1357, 0.1639, -1.6796),
new THREE.Vector3(-1.1366, 0.1639, -1.6342),
new THREE.Vector3(-1.1366, 0.1639, -1.5407),
new THREE.Vector3(-1.1366, 0.1639, -1.3913),
new THREE.Vector3(-1.1366, 0.1639, -1.2012),
new THREE.Vector3(-1.1366, 0.1639, -0.9858),
new THREE.Vector3(-1.1366, 0.1639, -0.7605),
new THREE.Vector3(-1.1366, 0.1639, -0.5405),
new THREE.Vector3(-1.1366, 0.1639, -0.3413),
new THREE.Vector3(-1.1366, 0.1639, -0.1780),
new THREE.Vector3(-1.1366, 0.1639, -0.0662),
];

initExperience(points);