import { useFit } from '../state/store';
import { SCENE_IDS, SCENES } from '../viewer/scenes';
import { MakeItReal } from './MakeItReal';

export function SceneBar() {
  const scene = useFit((s) => s.scene);
  const setScene = useFit((s) => s.setScene);
  const autoRotate = useFit((s) => s.autoRotate);
  const setAutoRotate = useFit((s) => s.setAutoRotate);

  return (
    <div className="scene-bar panel">
      <div className="pills" role="radiogroup" aria-label="Scene">
        {SCENE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={scene === id}
            className={`pill ${scene === id ? 'active' : ''}`}
            onClick={() => setScene(id)}
          >
            {SCENES[id].label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={`pill ${autoRotate ? 'active' : ''}`}
        aria-pressed={autoRotate}
        onClick={() => setAutoRotate(!autoRotate)}
        title="Auto-rotate"
      >
        ⟳ Spin
      </button>
      <MakeItReal />
    </div>
  );
}
