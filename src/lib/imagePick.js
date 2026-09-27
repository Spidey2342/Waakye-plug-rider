export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

/** @returns {File|null} */
export function readPickedImageFile(inputEl) {
  const file = inputEl.files?.[0];
  if (!file) return null;
  if (!ALLOWED_TYPES.has(file.type) && !file.type.startsWith('image/')) {
    throw new Error('Please choose a photo (JPEG, PNG, or WebP).');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('Photo must be 5 MB or smaller.');
  }
  return file;
}

export function loadFilePreview(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that photo.'));
    reader.readAsDataURL(file);
  });
}
