// src/utils/cloudinary-utils.ts
import { v2 as cloudinary } from 'cloudinary';
import { Logger } from '../services/logger.service';
import { CONFIG } from '../config';

// Initialize Cloudinary (add credentials to your config)
cloudinary.config({
    cloud_name: CONFIG.CLOUDINARY_CLOUD_NAME,
    api_key: CONFIG.CLOUDINARY_API_KEY,
    api_secret: CONFIG.CLOUDINARY_API_SECRET,
});

/**
 * Deletes an image from Cloudinary using its public ID
 */
export async function deleteCloudinaryImage(
    publicId: string,
): Promise<boolean> {
    try {
        if (!publicId) {
            Logger.warn(
                'Attempted to delete Cloudinary image with empty publicId',
                'CloudinaryUtils',
            );
            return false;
        }

        const result = await cloudinary.uploader.destroy(publicId);

        if (result.result === 'ok') {
            Logger.info(
                `Successfully deleted Cloudinary image: ${publicId}`,
                'CloudinaryUtils',
            );
            return true;
        } else {
            Logger.warn(
                `Failed to delete Cloudinary image ${publicId}: ${result.result}`,
                'CloudinaryUtils',
            );
            return false;
        }
    } catch (error) {
        Logger.error(
            new Error(`Error deleting Cloudinary image ${publicId}: ${error}`),
            'CloudinaryUtils',
        );
        return false;
    }
}

/**
 * Deletes multiple images from Cloudinary
 */
export async function deleteCloudinaryImages(
    publicIds: string[],
): Promise<{ success: string[]; failed: string[] }> {
    const results = {
        success: [] as string[],
        failed: [] as string[],
    };

    for (const publicId of publicIds.filter((id) => id)) {
        const success = await deleteCloudinaryImage(publicId);
        if (success) {
            results.success.push(publicId);
        } else {
            results.failed.push(publicId);
        }
    }

    return results;
}
