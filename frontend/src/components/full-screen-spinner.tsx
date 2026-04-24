import './full-screen-spinner.css';

export function FullScreenSpinner(): JSX.Element {
  return (
    <div className="full-screen-spinner" role="status" aria-label="Загрузка">
      <div className="full-screen-spinner__dot" />
    </div>
  );
}
