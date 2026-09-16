import type { CSSProperties } from 'react';
import { getRuntime, useCutoutStore } from '../store/cutout-store';

export function Toolstrip() {
  const tab = useCutoutStore((s) => s.tab);
  const tool = useCutoutStore((s) => s.tool);
  const brushRadius = useCutoutStore((s) => s.brushRadius);
  const canUndo = useCutoutStore((s) => s.canUndo);
  const canRedo = useCutoutStore((s) => s.canRedo);
  const brushDisabled = useCutoutStore((s) => s.brushDisabled);
  const brushTitle = useCutoutStore((s) => s.brushTitle);
  const bgMode = useCutoutStore((s) => s.bgMode);
  const color = useCutoutStore((s) => s.color);
  const threshold = useCutoutStore((s) => s.threshold);
  const gamma = useCutoutStore((s) => s.gamma);
  const invert = useCutoutStore((s) => s.invert);

  return (
    <div className="toolstrip editor-only" id="toolstrip">
      <section className="panel-row" data-panel="cutout" hidden={tab !== 'cutout'}>
        <div className="tool-block">
          <span className="tool-kicker">Magic Brush</span>
          <div className="segmented" id="tool-modes">
            <button
              type="button"
              data-tool="compare"
              className={tool === 'compare' ? 'active' : undefined}
              data-testid="tool-compare"
              onClick={() => getRuntime().setTool('compare')}
            >
              对比
            </button>
            <button
              type="button"
              data-tool="erase"
              className={tool === 'erase' ? 'active' : undefined}
              data-testid="tool-brush"
              disabled={brushDisabled}
              title={brushTitle}
              onClick={() => getRuntime().setTool('erase')}
            >
              擦除
            </button>
            <button
              type="button"
              data-tool="restore"
              className={tool === 'restore' ? 'active' : undefined}
              data-testid="tool-restore"
              disabled={brushDisabled}
              title={brushTitle}
              onClick={() => getRuntime().setTool('restore')}
            >
              恢复
            </button>
          </div>
        </div>
        <label className="slider inline">
          <span>
            画笔大小 <b id="val-radius" data-testid="val-radius">{brushRadius}</b>
          </span>
          <input
            id="rng-radius"
            data-testid="rng-radius"
            type="range"
            min={4}
            max={160}
            step={1}
            value={brushRadius}
            onChange={(e) => getRuntime().setRadius(parseFloat(e.target.value))}
          />
        </label>
        <div className="icon-actions">
          <button type="button" id="btn-undo" data-testid="btn-undo" disabled={!canUndo} title="撤销" onClick={() => getRuntime().undo()}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12.5 8c-2.4 0-4.5 1-6 2.6L4 8v8h8l-2.6-2.5A6.5 6.5 0 1 1 12.5 21H11v-2h1.5a4.5 4.5 0 1 0 0-11Z"
              />
            </svg>
            撤销
          </button>
          <button type="button" id="btn-redo" data-testid="btn-redo" disabled={!canRedo} title="重做" onClick={() => getRuntime().redo()}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M11.5 8c2.4 0 4.5 1 6 2.6L20 8v8h-8l2.6-2.5A6.5 6.5 0 1 0 11.5 21H13v-2h-1.5a4.5 4.5 0 1 1 0-11Z"
              />
            </svg>
            重做
          </button>
        </div>
      </section>

      <section className="panel-row" data-panel="background" hidden={tab !== 'background'}>
        <div className="tool-block">
          <span className="tool-kicker">背景</span>
          <div className="segmented" id="bg-modes">
            <button data-mode="transparent" className={bgMode === 'transparent' ? 'active' : undefined} onClick={() => getRuntime().setBgMode('transparent')}>
              透明
            </button>
            <button data-mode="color" className={bgMode === 'color' ? 'active' : undefined} onClick={() => getRuntime().setBgMode('color')}>
              纯色
            </button>
            <button data-mode="dim" className={bgMode === 'dim' ? 'active' : undefined} onClick={() => getRuntime().setBgMode('dim')}>
              原图变暗
            </button>
          </div>
        </div>
        <div className="swatches" id="bg-swatches">
          <Swatch color="#ffffff" forceMode="transparent" title="透明" checker bgMode={bgMode} current={color} />
          <Swatch color="#ffffff" title="白" style={{ background: '#fff' }} bgMode={bgMode} current={color} />
          <Swatch color="#000000" title="黑" style={{ background: '#111' }} bgMode={bgMode} current={color} />
          <Swatch color="#0F70E6" title="蓝" style={{ background: '#0f70e6' }} bgMode={bgMode} current={color} />
          <Swatch color="#ffc83e" title="黄" style={{ background: '#ffc83e' }} bgMode={bgMode} current={color} />
          <Swatch color="#e9ebec" title="浅灰" style={{ background: '#e9ebec' }} bgMode={bgMode} current={color} />
          <Swatch color="#db1436" title="红" style={{ background: '#db1436' }} bgMode={bgMode} current={color} />
        </div>
        <label className="field color-field" id="color-field" hidden={bgMode !== 'color'}>
          <span>自定义</span>
          <input id="inp-color" type="color" value={color} onChange={(e) => getRuntime().setColor(e.target.value)} />
        </label>
      </section>

      <section className="panel-row" data-panel="adjust" hidden={tab !== 'adjust'}>
        <label className="slider inline">
          <span>
            阈值 <b id="val-threshold">{threshold.toFixed(2)}</b>
          </span>
          <input
            id="rng-threshold"
            type="range"
            min={0}
            max={0.95}
            step={0.01}
            value={threshold}
            onChange={(e) => getRuntime().setAdjust({ threshold: parseFloat(e.target.value) })}
          />
        </label>
        <label className="slider inline">
          <span>
            羽化 <b id="val-gamma">{gamma.toFixed(2)}</b>
          </span>
          <input
            id="rng-gamma"
            type="range"
            min={0.2}
            max={3}
            step={0.05}
            value={gamma}
            onChange={(e) => getRuntime().setAdjust({ gamma: parseFloat(e.target.value) })}
          />
        </label>
        <label className="check">
          <input id="chk-invert" type="checkbox" checked={invert} onChange={(e) => getRuntime().setAdjust({ invert: e.target.checked })} />
          <span>反相遮罩</span>
        </label>
      </section>
    </div>
  );
}

function Swatch({
  color,
  title,
  style,
  checker,
  forceMode,
  bgMode,
  current,
}: {
  color: string;
  title: string;
  style?: CSSProperties;
  checker?: boolean;
  forceMode?: string;
  bgMode: string;
  current: string;
}) {
  const on =
    forceMode === 'transparent' ? bgMode === 'transparent' : bgMode === 'color' && color.toLowerCase() === current.toLowerCase();
  return (
    <button
      type="button"
      className={`swatch${checker ? ' checker-swatch' : ''}${on ? ' active' : ''}`}
      data-color={color}
      data-force-mode={forceMode}
      title={title}
      style={style}
      onClick={() => getRuntime().pickSwatch(color, forceMode)}
    />
  );
}
