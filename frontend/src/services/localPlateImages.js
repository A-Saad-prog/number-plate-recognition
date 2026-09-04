const DB_NAME = "parking-local-images";
const STORE_NAME = "folders";
const HANDLE_KEY = "plate-images";

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
    if (!handle || await handle.queryPermission({ mode: "readwrite" }) !== "granted") return false;
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const safePlate = String(plate).replace(/[^A-Z0-9-]/gi, "_");
    const lane = String(source || "").startsWith("exit-") ? "Exit" : "Entry";
    const response = await fetch(imageDataUrl);
    const dateFolder = await handle.getDirectoryHandle(date, { create: true });
    const laneFolder = await dateFolder.getDirectoryHandle(lane, { create: true });
    const file = await laneFolder.getFileHandle(`${safePlate}_${date}_${time}.jpg`, { create: true });
    const writable = await file.createWritable();
    await writable.write(await response.blob());
    await writable.close();
    return true;
}
