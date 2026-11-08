// glTF animation clips baked by the pipeline (single keyframe each). The rest A-pose is only for binding.
export type PoseId = 'relaxed' | 'pocket' | 'walk';
export const POSE_IDS: PoseId[] = ['relaxed', 'pocket', 'walk'];
export const DEFAULT_POSE: PoseId = 'relaxed';
export const POSE_LABEL: Record<PoseId, string> = { relaxed: 'Relaxed', pocket: 'Pocket', walk: 'Walk' };
export const POSE_FADE_S = 0.4;
