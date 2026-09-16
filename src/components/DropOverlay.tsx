import { useCutoutStore } from '../store/cutout-store';

export function DropOverlay() {
  const hidden = useCutoutStore((s) => s.dropOverlayHidden);
  return (
    <div id="drop-overlay" className="drop-overlay" hidden={hidden}>
      <div className="drop-overlay-card">
        <p>将图片拖到这里</p>
        <span>一次一张</span>
      </div>
    </div>
  );
}
