type PageHeaderProps = {
  title: string;
  description?: string;
  /** Right-aligned actions or a status badge. */
  aside?: React.ReactNode;
};

/** Title block shared by every page inside the app shell. */
export function PageHeader({ title, description, aside }: PageHeaderProps) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description ? <p className="max-w-2xl leading-relaxed text-muted">{description}</p> : null}
      </div>
      {aside ? <div className="flex shrink-0 items-center gap-2">{aside}</div> : null}
    </div>
  );
}
