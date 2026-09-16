import { useEffect } from 'react';
import { host } from '../cutout/host';
import { getRuntime, useCutoutStore } from '../store/cutout-store';

export function Workspace() {
  const emptyHidden = useCutoutStore((s) => s.emptyHidden);
  const compareHidden = useCutoutStore((s) => s.compareHidden);
  const checkerOn = useCutoutStore((s) => s.checkerOn);
  const handleHidden = useCutoutStore((s) => s.handleHidden);
  const busyHidden = useCutoutStore((s) => s.busyHidden);
  const busyText = useCutoutStore((s) => s.busyText);
  const imgSrc = useCutoutStore((s) => s.imgSrc);
  const imgClip = useCutoutStore((s) => s.imgClip);
  const canvasClip = useCutoutStore((s) => s.canvasClip);
  const frameW = useCutoutStore((s) => s.frameW);
  const frameH = useCutoutStore((s) => s.frameH);
  const view = useCutoutStore((s) => s.view);
  const splitAt = useCutoutStore((s) => s.splitAt);
  const stageHint = useCutoutStore((s) => s.stageHint);
  const timings = useCutoutStore((s) => s.timings);
  const dropzoneDragover = useCutoutStore((s) => s.dropzoneDragover);
  const dropzoneBrushOn = useCutoutStore((s) => s.dropzoneBrushOn);
  const dropzonePanning = useCutoutStore((s) => s.dropzonePanning);
  const dropzoneIsPanning = useCutoutStore((s) => s.dropzoneIsPanning);
  const brushCursor = useCutoutStore((s) => s.brushCursor);

  useEffect(() => {
    const el = host.dropzone;
    if (!el) return;
    const ro = new ResizeObserver(() => getRuntime().fitFrame());
    ro.observe(el);
    const onWheel = (e: WheelEvent) => getRuntime().onWheel(e);
    el.addEventListener('wheel', onWheel, { passive: false });
    const onResize = () => getRuntime().fitFrame();
    window.addEventListener('resize', onResize);
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const dropClass = [
    'dropzone',
    dropzoneDragover ? 'dragover' : '',
    dropzoneBrushOn ? 'brush-on' : '',
    dropzonePanning ? 'panning' : '',
    dropzoneIsPanning ? 'is-panning' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <main className="workspace">
      <section className="stage">
        <div
          className={dropClass}
          id="dropzone"
          data-testid="dropzone"
          ref={(el) => {
            host.dropzone = el;
          }}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('.handle')) return;
            if (emptyHidden) return;
            getRuntime().openFilePicker();
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            useCutoutStore.setState({ dropzoneDragover: true });
          }}
          onDragOver={(e) => {
            e.preventDefault();
            useCutoutStore.setState({ dropzoneDragover: true });
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            useCutoutStore.setState({ dropzoneDragover: false });
          }}
          onDrop={(e) => {
            e.preventDefault();
            useCutoutStore.setState({ dropzoneDragover: false });
          }}
        >
          <input
            id="file-input"
            data-testid="file-input"
            type="file"
            accept="image/*"
            hidden
            ref={(el) => {
              host.fileInput = el;
            }}
            onChange={() => getRuntime().onFileInputChange()}
          />
          <div className="empty" id="empty" hidden={emptyHidden}>
            <div className="upload-card">
              <button
                type="button"
                className="btn-upload"
                id="btn-upload"
                onClick={(e) => {
                  e.stopPropagation();
                  getRuntime().openFilePicker();
                }}
              >
                上传图片
              </button>
              <p className="upload-or">或拖入文件，粘贴图片</p>
              <p className="upload-types">PNG / JPEG / WebP</p>
            </div>
          </div>

          <div
            className="compare"
            id="compare"
            data-testid="compare"
            hidden={compareHidden}
            ref={(el) => {
              host.compare = el;
            }}
            onPointerMove={(e) => getRuntime().onComparePointerMove(e.nativeEvent)}
            onPointerDown={(e) => getRuntime().onComparePointerDown(e.nativeEvent)}
            onPointerUp={(e) => getRuntime().endStroke(e.nativeEvent)}
            onPointerCancel={(e) => getRuntime().endStroke(e.nativeEvent)}
            onLostPointerCapture={(e) => getRuntime().onLostCapture(e.nativeEvent)}
            onPointerLeave={() => getRuntime().hideCursorIfIdle()}
          >
            <div
              className="frame"
              id="frame"
              ref={(el) => {
                host.frame = el;
              }}
              style={{
                width: frameW ? `${frameW}px` : undefined,
                height: frameH ? `${frameH}px` : undefined,
                transformOrigin: 'center center',
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
              }}
            >
              <div className="checker" id="checker" style={{ display: checkerOn ? 'block' : 'none' }} />
              <img
                id="img-original"
                alt="原图"
                src={imgSrc || undefined}
                ref={(el) => {
                  host.img = el;
                }}
                style={{ clipPath: imgClip }}
              />
              <canvas
                id="canvas-result"
                data-testid="canvas-result"
                ref={(el) => {
                  host.canvas = el;
                }}
                style={{ clipPath: canvasClip }}
              />
              <div
                className="handle"
                id="handle"
                hidden={handleHidden}
                ref={(el) => {
                  host.handle = el;
                }}
                style={{ left: `${splitAt * 100}%` }}
                onPointerDown={(e) => getRuntime().onHandlePointerDown(e.nativeEvent)}
                onPointerMove={(e) => getRuntime().onHandlePointerMove(e.nativeEvent)}
                onPointerUp={(e) => getRuntime().onHandlePointerUp(e.nativeEvent)}
              >
                <span />
              </div>
            </div>
          </div>
          <div className="busy" id="busy" hidden={busyHidden}>
            <span className="spinner" />
            <span id="busy-text">{busyText}</span>
          </div>
          <div
            id="brush-cursor"
            className={`brush-cursor source-sam${brushCursor.erase ? ' kind-erase' : ''}${brushCursor.restore ? ' kind-restore' : ''}`}
            hidden={brushCursor.hidden}
            style={{
              width: `${brushCursor.width}px`,
              height: `${brushCursor.height}px`,
              left: `${brushCursor.left}px`,
              top: `${brushCursor.top}px`,
            }}
          />
        </div>

        <div className="stage-footer editor-only">
          <div className="zoom-dock">
            <button type="button" id="btn-zoom-out" title="缩小" onClick={() => getRuntime().zoomOut()}>
              −
            </button>
            <button type="button" id="btn-zoom-reset" title="100%" onClick={() => getRuntime().zoomReset()}>
              {`${Math.round(view.zoom * 100)}%`}
            </button>
            <button type="button" id="btn-zoom-in" title="放大" onClick={() => getRuntime().zoomIn()}>
              +
            </button>
          </div>
          <p className="hint center" id="stage-hint">
            {stageHint}
          </p>
          <p className="hint timings" id="timings">
            {timings}
          </p>
        </div>
      </section>
    </main>
  );
}
