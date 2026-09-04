const DB_NAME = "parking-local-images";
const STORE_NAME = "folders";
const HANDLE_KEY = "plate-images";
const folderCache = new WeakMap();

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getHandle() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(HANDLE_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

async function storeHandle(handle) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(handle, HANDLE_KEY);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
    });
}

export const localPlateImageSupport = () => "showDirectoryPicker" in window && "indexedDB" in window;

export async function selectPlateImageFolder() {
    if (!localPlateImageSupport()) throw new Error("Local folder saving requires a Chromium browser.");
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    return { handle, name: handle.name };
}

export async function activatePlateImageFolder(handle) {
    if (!handle) return null;
    await storeHandle(handle);
    return handle.name;
}

export async function savedPlateImageFolderName() {
    if (!localPlateImageSupport()) return null;
    return (await getHandle())?.name || null;
}

export async function saveConfirmedPlateImage({ plate, source, imageDataUrl }) {
    if (!localPlateImageSupport() || !imageDataUrl) return false;
    const handle = await getHandle();
    if (!handle) {
        console.info("[Local image] save skipped: no active folder handle");
        return false;
    }
    if (await handle.queryPermission({ mode: "readwrite" }) !== "granted") {
        console.info("[Local image] save skipped: folder write permission is not granted");
        return false;
    }
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const safePlate = String(plate).replace(/[^A-Z0-9-]/gi, "_");
    const lane = String(source || "").startsWith("exit-") ? "Exit" : "Entry";
    const response = await fetch(imageDataUrl);
    let folders = folderCache.get(handle);
    if (!folders) {
        folders = new Map();
        folderCache.set(handle, folders);
    }
    const folderKey = `${date}/${lane}`;
    let laneFolder = folders.get(folderKey);
    if (!laneFolder) {
        const dateFolder = await handle.getDirectoryHandle(date, { create: true });
        laneFolder = await dateFolder.getDirectoryHandle(lane, { create: true });
        folders.set(folderKey, laneFolder);
    }
    const file = await laneFolder.getFileHandle(`${safePlate}_${date}_${time}.jpg`, { create: true });
    const writable = await file.createWritable();
    await writable.write(await response.blob());
    await writable.close();
    return true;
}
