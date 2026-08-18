const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL ||
    "http://127.0.0.1:8000";


// ============================================================
// Parking
// ============================================================

export async function getParkingSpaces() {

    const response = await fetch(
        `${API_BASE_URL}/parking/spaces`
    );

    if (!response.ok) {

        throw new Error(
            `Failed to get parking spaces: ${response.status}`
        );

    }

    return await response.json();
}


export async function registerEntry(
    licensePlate,
    parkingSpaceId
) {

    const response = await fetch(
        `${API_BASE_URL}/parking/entry`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
            },

            body: JSON.stringify({
                license_plate: licensePlate,
                parking_space_id: parkingSpaceId,
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


export async function exitUsingPlate(
    licensePlate
) {

    const response = await fetch(
        `${API_BASE_URL}/parking/exit`,
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
// Vision
// ============================================================

export async function detectPlateFromFrame(image) {

    const response = await fetch(
        `${API_BASE_URL}/vision/detect-plate`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
            },

            body: JSON.stringify({
                image,
            }),
        }
    );

    if (!response.ok) {

        throw new Error(
            `Vision API returned ${response.status}`
        );

    }

    return await response.json();
}