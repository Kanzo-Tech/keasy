export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <p className="text-8xl font-bold tracking-tight text-muted-foreground/30">404</p>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground max-w-xs">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
    </div>
  );
}
