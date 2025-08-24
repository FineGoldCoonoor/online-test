// === Drive API endpoint from your Apps Script deployment ===
const DRIVE_API_URL = 'https://script.google.com/macros/s/AKfycbyHVOriK2qu99zk8VW7j88z8k2Jm2EJ5UwALVteW9h4sWAWFyyvTiU87EXIc5F3mH8/exec';
const driveCache = new Map();

// === Existing DOM refs ===
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('overlay');
const canvasCtx = canvasElement.getContext('2d');

let currentMode = null;
let earringImg = null;
let necklaceImg = null;
let earringSrc = '';
let necklaceSrc = '';
let lastSnapshotDataURL = '';
let currentType = '';
let smoothedLandmarks = null;

// Load an image (with CORS handling for snapshots)
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
  });
}

function changeEarring(src) {
  earringSrc = src;
  loadImage(earringSrc).then(img => { if (img) earringImg = img; });
}

function changeNecklace(src) {
  necklaceSrc = src;
  loadImage(necklaceSrc).then(img => { if (img) necklaceImg = img; });
}

// === Fetch image list from Drive by category ===
async function fetchDriveImagesByCategory(category) {
  const cacheKey = `cat:${category}`;
  if (driveCache.has(cacheKey)) return driveCache.get(cacheKey);

  const url = `${DRIVE_API_URL}?category=${encodeURIComponent(category)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Drive API failed (${res.status})`);
  const json = await res.json();
  if (!json.items) throw new Error('Invalid response from Drive API');

  driveCache.set(cacheKey, json.items);
  return json.items;
}

// Toggle between Gold / Diamond → show only matching sub-buttons
function toggleCategory(category) {
  document.getElementById('subcategory-buttons').style.display = 'flex';
  const subButtons = document.querySelectorAll('#subcategory-buttons button');
  subButtons.forEach(btn => {
    btn.style.display = btn.innerText.toLowerCase().includes(category)
      ? 'inline-block'
      : 'none';
  });
  document.getElementById('jewelry-options').style.display = 'none';
}

// Select a jewelry type (earrings/necklaces) and load options from Drive
async function selectJewelryType(type) {
  currentType = type;
  const container = document.getElementById('jewelry-options');
  container.style.display = 'flex';
  container.innerHTML = '<div style="color:#fff;padding:6px 10px">Loading...</div>';

  // Clear previously selected overlays
  earringImg = necklaceImg = null;
  earringSrc = necklaceSrc = '';

  try {
    const items = await fetchDriveImagesByCategory(type);
    if (!items.length) {
      container.innerHTML = '<div style="color:#fff;padding:6px 10px">No images found in this folder.</div>';
      return;
    }

    container.innerHTML = '';
    for (const item of items) {
      const btn = document.createElement('button');
      const img = document.createElement('img');
      img.src = item.thumb || item.link; // thumbnail for option tray
      img.alt = item.name;
      btn.appendChild(img);

      btn.onclick = () => {
        if (type.includes('earrings')) {
          changeEarring(item.link);
        } else {
          changeNecklace(item.link);
        }
      };

      container.appendChild(btn);
    }
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div style="color:#fff;padding:6px 10px">Failed to load images from Google Drive.</div>';
  }
}

// === FaceMesh setup ===
const faceMesh = new FaceMesh({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
});
faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: true,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6
});
faceMesh.onResults((results) => {
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    const newLandmarks = results.multiFaceLandmarks[0];
    if (!smoothedLandmarks) {
      smoothedLandmarks = newLandmarks;
    } else {
      smoothedLandmarks = smoothedLandmarks.map((prev, i) => ({
        x: prev.x * 0.8 + newLandmarks[i].x * 0.2,
        y: prev.y * 0.8 + newLandmarks[i].y * 0.2,
        z: prev.z * 0.8 + newLandmarks[i].z * 0.2,
      }));
    }
    drawJewelry(smoothedLandmarks, canvasCtx);
  }
});

const camera = new Camera(videoElement, {
  onFrame: async () => { await faceMesh.send({ image: videoElement }); },
  width: 1280,
  height: 720
});
videoElement.addEventListener('loadedmetadata', () => {
  canvasElement.width = videoElement.videoWidth;
  canvasElement.height = videoElement.videoHeight;
});
camera.start();

// === Overlay drawing ===
function drawJewelry(landmarks, ctx) {
  const earringScale = 0.07;
  const necklaceScale = 0.18;

  const leftEar = { x: landmarks[132].x * canvasElement.width - 6,  y: landmarks[132].y * canvasElement.height - 16 };
  const rightEar = { x: landmarks[361].x * canvasElement.width + 6, y: landmarks[361].y * canvasElement.height - 16 };
  const neck = { x: landmarks[152].x * canvasElement.width - 8,    y: landmarks[152].y * canvasElement.height + 10 };

  if (earringImg) {
    const w = earringImg.width * earringScale;
    const h = earringImg.height * earringScale;
    ctx.drawImage(earringImg, leftEar.x - w / 2, leftEar.y,  w, h);
    ctx.drawImage(earringImg, rightEar.x - w / 2, rightEar.y, w, h);
  }
  if (necklaceImg) {
    const w = necklaceImg.width * necklaceScale;
    const h = necklaceImg.height * necklaceScale;
    ctx.drawImage(necklaceImg, neck.x - w / 2, neck.y, w, h);
  }
}

// === Snapshot functions ===
function takeSnapshot() {
  if (!smoothedLandmarks) {
    alert("Face not detected. Please try again.");
    return;
  }
  try {
    const snapshotCanvas = document.createElement('canvas');
    const ctx = snapshotCanvas.getContext('2d');
    snapshotCanvas.width = videoElement.videoWidth;
    snapshotCanvas.height = videoElement.videoHeight;
    ctx.drawImage(videoElement, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
    drawJewelry(smoothedLandmarks, ctx);
    lastSnapshotDataURL = snapshotCanvas.toDataURL('image/png');
    document.getElementById('snapshot-preview').src = lastSnapshotDataURL;
    document.getElementById('snapshot-modal').style.display = 'block';
  } catch (e) {
    console.error(e);
    alert("Snapshot failed (Google Drive images may block CORS). Try Firebase or GitHub for images if needed.");
  }
}

function saveSnapshot() {
  const link = document.createElement('a');
  link.href = lastSnapshotDataURL;
  link.download = `jewelry-tryon-${Date.now()}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function shareSnapshot() {
  if (navigator.share) {
    fetch(lastSnapshotDataURL)
      .then(res => res.blob())
      .then(blob => {
        const file = new File([blob], 'jewelry-tryon.png', { type: 'image/png' });
        navigator.share({ title: 'Jewelry Try-On', text: 'Check out my look!', files: [file] });
      })
      .catch(console.error);
  } else {
    alert('Sharing not supported on this browser.');
  }
}

function closeSnapshotModal() {
  document.getElementById('snapshot-modal').style.display = 'none';
}
function toggleInfoModal() {
  const modal = document.getElementById('info-modal');
  modal.style.display = modal.style.display === 'block' ? 'none' : 'block';
}
