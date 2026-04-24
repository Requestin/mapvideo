import { EditorStateProvider } from '../state/editor-state';
import { EditorMapProvider } from '../hooks/use-editor-map';
import { UserColorsProvider } from '../state/user-colors';
import { EditorWorkspace } from '../components/editor-workspace';
import './editor-page.css';

// Layout matches SPEC.md: Header 48px / body (16:9 preview + right panel
// 320px) / bottom toolbar 56px. The preview box enforces aspect-ratio
// 16/9 so WYSIWYG with the rendered video is guaranteed (SPEC.md: "строго
// 16:9 — пользователь видит ровно то что будет на видео").
export function EditorPage(): JSX.Element {
  return (
    <UserColorsProvider>
      <EditorStateProvider>
        <EditorMapProvider>
          <EditorWorkspace />
        </EditorMapProvider>
      </EditorStateProvider>
    </UserColorsProvider>
  );
}
