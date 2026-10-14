import { supabase, isSupabaseConfigured } from '../lib/supabase';

const BUCKET_NAME = 'student-photos';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// In-memory / indexed storage cache for local development fallback
const localPhotoStore = new Map<string, Blob>();

export const validatePhotoFile = (file: File): { valid: boolean; error?: string } => {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: 'Invalid file type. Please upload a JPEG, PNG, or WebP image.',
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds the 5 MB limit (Current: ${(file.size / (1024 * 1024)).toFixed(2)} MB).`,
    };
  }

  return { valid: true };
};

export const uploadStudentPhoto = async (
  file: File,
  instructorId: string,
  onProgress?: (pct: number) => void
): Promise<{ photoPath: string; photoUrl: string }> => {
  const validation = validatePhotoFile(file);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid file');
  }

  if (onProgress) onProgress(20);

  const ext = file.name.split('.').pop() || 'jpg';
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${ext}`;
  const filePath = `${instructorId}/${fileName}`;

  if (isSupabaseConfigured()) {
    if (onProgress) onProgress(45);
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      console.error('Supabase storage upload error:', uploadError);
      throw new Error(`Photo upload failed: ${uploadError.message}`);
    }

    if (onProgress) onProgress(80);

    // Generate signed URL valid for 1 hour for secure preview
    const { data: signedData, error: signError } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(filePath, 3600);

    if (signError || !signedData?.signedUrl) {
      console.error('Failed to create signed URL:', signError);
      throw new Error('Failed to retrieve secure photo URL');
    }

    if (onProgress) onProgress(100);
    return {
      photoPath: filePath,
      photoUrl: signedData.signedUrl,
    };
  } else {
    // Local development storage simulation
    localPhotoStore.set(filePath, file);
    if (onProgress) onProgress(80);
    const photoUrl = URL.createObjectURL(file);
    if (onProgress) onProgress(100);
    return {
      photoPath: filePath,
      photoUrl,
    };
  }
};

export const getStudentPhotoUrl = async (photoPath: string): Promise<string> => {
  if (!photoPath) return '';

  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(photoPath, 3600);

    if (error || !data?.signedUrl) {
      console.warn(`Could not create signed URL for ${photoPath}:`, error);
      return '';
    }
    return data.signedUrl;
  } else {
    const blob = localPhotoStore.get(photoPath);
    if (blob) {
      return URL.createObjectURL(blob);
    }
    // If it's a seed avatar or external fallback path
    if (photoPath.startsWith('http') || photoPath.startsWith('/')) {
      return photoPath;
    }
    return '';
  }
};

export const deleteStudentPhoto = async (photoPath: string): Promise<void> => {
  if (!photoPath) return;

  if (isSupabaseConfigured()) {
    const { error } = await supabase.storage.from(BUCKET_NAME).remove([photoPath]);
    if (error) {
      console.warn('Failed to delete student photo from storage:', error);
    }
  } else {
    localPhotoStore.delete(photoPath);
  }
};

const CLASSROOM_BUCKET = 'classroom-photos';

export const uploadClassroomPhoto = async (
  file: File | Blob,
  instructorId: string,
  sessionId: string,
  fileName?: string
): Promise<{ photoPath: string; photoUrl: string }> => {
  const name = fileName || `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.jpg`;
  const filePath = `${instructorId}/${sessionId}/${name}`;

  if (isSupabaseConfigured()) {
    const { error: uploadError } = await supabase.storage
      .from(CLASSROOM_BUCKET)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true,
      });

    if (uploadError) {
      console.error('Supabase classroom storage upload error:', uploadError);
      throw new Error(`Classroom photo upload failed: ${uploadError.message}`);
    }

    const { data: signedData, error: signError } = await supabase.storage
      .from(CLASSROOM_BUCKET)
      .createSignedUrl(filePath, 3600);

    if (signError || !signedData?.signedUrl) {
      throw new Error('Failed to retrieve secure classroom photo URL');
    }

    return { photoPath: filePath, photoUrl: signedData.signedUrl };
  } else {
    localPhotoStore.set(filePath, file);
    return { photoPath: filePath, photoUrl: URL.createObjectURL(file) };
  }
};

export const getClassroomPhotoUrl = async (photoPath: string): Promise<string> => {
  if (!photoPath) return '';
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.storage
      .from(CLASSROOM_BUCKET)
      .createSignedUrl(photoPath, 3600);
    if (error || !data?.signedUrl) return '';
    return data.signedUrl;
  }
  const blob = localPhotoStore.get(photoPath);
  if (blob) return URL.createObjectURL(blob);
  if (photoPath.startsWith('http') || photoPath.startsWith('/')) return photoPath;
  return '';
};

