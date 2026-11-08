import { useFit } from '../state/store';
import { SCENE_IDS, SCENES, type SceneId } from '../viewer/scenes';

// Tile looks from the design (1a).
const TILE: Record<SceneId, { bg: string; fg: string; hint: string }> = {
  studio: { bg: '#F4F2EC', fg: '#6B675F', hint: 'paper' },
  city: { bg: 'repeating-linear-gradient(135deg,#CFCBC2 0 5px,#DAD6CE 5px 10px)', fg: '#3F3C37', hint: 'street' },
  night: { bg: 'repeating-linear-gradient(135deg,#262626 0 5px,#303030 5px 10px)', fg: '#CFCBC2', hint: 'dusk' },
};

export function SceneSection() {
  const scene = useFit((s) => s.scene);
  const setScene = useFit((s) => s.setScene);
  return (
    <section className="rail-section">
      <h2 className="eyebrow">Scene</h2>
      <div className="scene-tiles" role="radiogroup" aria-label="Scene">
        {SCENE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={scene === id}
            className={`scene-tile ${scene === id ? 'active' : ''}`}
            onClick={() => setScene(id)}
          >
            <span className="scene-frame">
              <span className="scene-swatch" style={{ background: TILE[id].bg, color: TILE[id].fg }}>
                {TILE[id].hint}
              </span>
            </span>
            <span className="scene-name">{SCENES[id].label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
