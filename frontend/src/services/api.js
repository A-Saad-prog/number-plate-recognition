const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL ||
    "http://127.0.0.1:8000";


// ============================================================
// Get Available Parking Space
// ============================================================

export async function getAvailableSpace() {

    const response = await fetch(
        `${API_BASE_URL}/parking/available-space`
    );

    if (!response.ok) {

        throw new Error(
            `Failed to get available parking space: ${response.status}`
        );

    }

    return await response.json();
}


// ============================================================
// Get Latest Detected License Plate
// ============================================================

export async function getDetectedPlate() {

    const response = await fetch(
        `${API_BASE_URL}/parking/detected-plate`
    );

    if (!response.ok) {

        throw new Error(
            `Failed to get detected plate: ${response.status}`
        );

    }

    return await response.json();
}


// ============================================================
// Get Parking Spaces
// ============================================================

export async function getParkingSpaces() {

    const response = await fetch(
        `${API_BASE_URL}/parking/spaces`
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {

        throw new Error(
            data.error || `Failed to get parking spaces: ${response.status}`
        );

    }

    return data;
}


// ============================================================
// Detect Plate from Camera Frame
// ============================================================

export async function detectPlateFromFrame(imageDataUrl) {

    const response = await fetch(
        `${API_BASE_URL}/vision/detect-plate`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
            },

            body: JSON.stringify({
                image: imageDataUrl,
            }),
        }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {

        throw new Error(
            data.detail || `Failed to detect plate: ${response.status}`
        );

    }

    return data;
}


// ============================================================
// Register Vehicle Entry
// ============================================================

export async function registerEntry(licensePlate) {

    const response = await fetch(
        `${API_BASE_URL}/parking/entry`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
            },

            body: JSON.stringify({
                license_plate: licensePlate,
            }),
        }
    );

    if (!response.ok) {

        throw new Error(
            `Failed to register vehicle entry: ${response.status}`
        );

    }

    return await response.json();
}


// ============================================================
// Exit Using License Plate
// ============================================================

export async function exitUsingPlate(licensePlate) {

    const response = await fetch(
        `${API_BASE_URL}/parking/exit/plate`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
            },

            body: JSON.stringify({
                license_plate: licensePlate,
            }),
        }
    );

    if (!response.ok) {

        throw new Error(
            `Failed to process vehicle exit: ${response.status}`
        );

    }

    return await response.json();
}


// ============================================================
// Exit Using QR Code
// ============================================================

export async function exitUsingQR(qrCode) {

    const response = await fetch(
        `${API_BASE_URL}/parking/exit/qr`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
            },

            body: JSON.stringify({
                qr_code: qrCode,
            }),
        }
    );

    if (!response.ok) {

        throw new Error(
            `Failed to process QR exit: ${response.status}`
        );

    }

    return await response.json();
}


// ============================================================
// Admin Authentication and Whitelist Management
// ============================================================

export async function loginAdmin(username, password) {
    const response = await fetch(`${API_BASE_URL}/admin/login`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.detail || `Login failed: ${response.status}`);
    }

    return data;
}

export async function getAdminSession(token) {
    const response = await fetch(`${API_BASE_URL}/admin/me`, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.detail || `Failed to get admin session: ${response.status}`);
    }

    return data;
}

export async function getWhitelist(token) {
    const response = await fetch(`${API_BASE_URL}/admin/whitelist`, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.detail || `Failed to get whitelist: ${response.status}`);
    }

    return data;
}

export async function addWhitelistEntry(token, entry) {
    const response = await fetch(`${API_BASE_URL}/admin/whitelist`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(entry),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.detail || `Failed to add whitelist entry: ${response.status}`);
    }

    return data;
}

export async function removeWhitelistEntry(token, search) {
    const response = await fetch(`${API_BASE_URL}/admin/whitelist`, {
        method: "DELETE",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ search }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.detail || `Failed to remove whitelist entry: ${response.status}`);
    }

    return data;
}