// src/utils/image-utils.ts

/**
 * Normalizes image data to the new format with url and publicId
 * Handles both legacy string format and new object format
 */
export function normalizeImageData(
    images?: (string | { url: string; publicId?: string })[],
): { url: string; publicId?: string }[] {
    if (!images || !Array.isArray(images)) {
        return [];
    }

    return images.map((image) => {
        if (typeof image === 'string') {
            // Legacy format - just a URL string
            return { url: image };
        } else if (
            typeof image === 'object' &&
            image !== null &&
            'url' in image
        ) {
            // New format - object with url and optional publicId
            return image;
        } else {
            // Invalid format
            throw new Error(`Invalid image format: ${JSON.stringify(image)}`);
        }
    });
}
