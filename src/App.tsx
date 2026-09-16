import { useLayoutEffect } from 'react';
import { AdvancedDialog } from './components/AdvancedDialog';
import { DropOverlay } from './components/DropOverlay';
import { Toolstrip } from './components/Toolstrip';
import { Topbar } from './components/Topbar';
import { Workspace } from './components/Workspace';
import { getRuntime, useCutoutStore } from './store/cutout-store';

let sessionStarted = false;

export function App() {
  const mode = useCutoutStore((s) => s.mode);

  useLayoutEffect(() => {
    document.body.classList.toggle('mode-upload', mode === 'upload');
    document.body.classList.toggle('mode-editor', mode === 'editor');
  }, [mode]);

  useLayoutEffect(() => {
    if (sessionStarted) return;
    sessionStarted = true;
    getRuntime().start();
  }, []);

  useLayoutEffect(() => {
    const runtime = getRuntime();
    const onDragEnter = (e: DragEvent) => runtime.onWindowDragEnter(e);
    const onDragLeave = () => runtime.onWindowDragLeave();
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => runtime.onWindowDrop(e);
    const onPaste = (e: ClipboardEvent) => runtime.onPaste(e);
    const onKeyDown = (e: KeyboardEvent) => runtime.onKeyDown(e);
    const onKeyUp = (e: KeyboardEvent) => runtime.onKeyUp(e);
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return (
    <>
      <div className="app">
        <Topbar />
        <Toolstrip />
        <AdvancedDialog />
        <Workspace />
      </div>
      <DropOverlay />
    </>
  );
}
