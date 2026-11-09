import { SCENE_IDS, SCENES } from '../look/scenes';
import { useApp } from '../state/store';

export function SceneSection() {
  const scene = useApp((s) => s.scene);
  const setScene = useApp((s) => s.setScene);
  return (
    <section className="rail-section" aria-labelledby="scene-title">
      <h2 className="eyebrow" id="scene-title">
        Setting
      </h2>
      <div className="scene-tiles" role="radiogroup" aria-label="Setting">
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
              <span className="scene-swatch" style={{ background: SCENES[id].tile.bg, color: SCENES[id].tile.fg }}>
                {SCENES[id].hint}
              </span>
            </span>
            <span className="scene-name">{SCENES[id].label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
