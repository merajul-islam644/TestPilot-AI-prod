import type { ReactNode } from "react";

/**
 * Route-matched loading skeletons. Each variant reuses the real page's layout
 * classes (.kpis, .grid-2, .cards-grid, .panel, .toolbar), so the placeholder
 * occupies the same geometry the content will and the page fills in place
 * instead of jumping when the gateway load resolves.
 */

// All bars share the .skeleton shimmer; sizes come from skel-* classes and
// inline widths. Widths are varied deterministically per row/column so the
// placeholder reads as content, not a striped wall of identical bars.
function Line({ tall = false, width }: { tall?: boolean; width: string }) {
  return <span className={tall ? "skeleton skel-line-lg" : "skeleton skel-line"} style={{ width }} />;
}

function Card({ children }: { children: ReactNode }) {
  return <div className="panel skel-card">{children}</div>;
}

/** Panel header: title bar left, action pill right. */
function HeadRow() {
  return (
    <div className="skel-row skel-row-between">
      <Line tall width="34%" />
      <span className="skeleton skel-chip" />
    </div>
  );
}

/** DataTable-like rows: one wide cell + three narrower ones. */
function TableRows({ count }: { count: number }) {
  const base = [78, 56, 64, 46];
  return (
    <>
      {Array.from({ length: count }, (_, row) => (
        <div aria-hidden="true" className="skel-tr" key={row}>
          {base.map((width, col) => (
            <span
              className="skeleton skel-line"
              key={col}
              style={{ width: `${width - ((row * 13 + col * 29) % 22)}%` }}
            />
          ))}
        </div>
      ))}
    </>
  );
}

function OverviewSkeleton() {
  return (
    <div className="page-skeleton">
      <div className="kpis">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <div className="skel-row">
              <span className="skeleton skel-icon" />
              <Line width="54%" />
            </div>
            <Line tall width="40%" />
            <span className="skeleton skel-spark" />
          </Card>
        ))}
      </div>
      <div className="grid-2">
        <Card>
          <HeadRow />
          <span className="skeleton skel-chart" />
        </Card>
        <Card>
          <HeadRow />
          {[0, 1, 2, 3].map((i) => (
            <div className="skel-row skel-row-between" key={i}>
              <Line width={`${58 - i * 8}%`} />
              <Line width="14%" />
            </div>
          ))}
        </Card>
      </div>
      <Card>
        <HeadRow />
        <TableRows count={5} />
      </Card>
    </div>
  );
}

function ProjectsSkeleton() {
  return (
    <div className="page-skeleton">
      <div className="cards-grid">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div className="panel project-card skel-card" key={i}>
            <div className="skel-row">
              <span className="skeleton skel-icon" />
              <Line width={`${66 - (i % 3) * 9}%`} tall />
            </div>
            <Line width="88%" />
            <Line width="64%" />
            <div className="skel-row skel-row-between">
              <Line width="22%" />
              <Line width="30%" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Runs / suites / issues lists: filter toolbar above a table panel. */
function ListSkeleton() {
  return (
    <div className="page-skeleton">
      <div className="toolbar">
        <span className="skeleton skel-search" />
        <span className="skeleton skel-chip" />
        <span className="skeleton skel-chip" />
        <span className="skeleton skel-btn" />
      </div>
      <Card>
        <TableRows count={7} />
      </Card>
    </div>
  );
}

/** Detail pages: title row, chip strip, then the main panel. */
function DetailSkeleton() {
  return (
    <div className="page-skeleton">
      <div className="skel-row skel-row-between">
        <Line tall width="32%" />
        <div className="skel-row">
          <span className="skeleton skel-btn" />
          <span className="skeleton skel-chip" />
        </div>
      </div>
      <div className="skel-row">
        <span className="skeleton skel-chip" />
        <span className="skeleton skel-chip" />
        <span className="skeleton skel-chip" />
        <span className="skeleton skel-chip" />
      </div>
      <Card>
        <HeadRow />
        <TableRows count={6} />
      </Card>
    </div>
  );
}

function ReportsSkeleton() {
  return (
    <div className="page-skeleton">
      <div className="grid-2">
        {[0, 1].map((i) => (
          <Card key={i}>
            <HeadRow />
            <span className="skeleton skel-chart" />
          </Card>
        ))}
      </div>
      <Card>
        <HeadRow />
        <TableRows count={5} />
      </Card>
    </div>
  );
}

/** Profile: hero card (photo + identity) above the access/session pair. */
function ProfileSkeleton() {
  return (
    <div className="page-skeleton">
      <div className="panel identity-hero">
        <div className="identity-body">
          <span className="skeleton skeleton-avatar-hero" />
          <div className="identity-main">
            <Line tall width="36%" />
            <Line width="52%" />
            <div className="skel-row">
              <span className="skeleton skel-chip" />
              <span className="skeleton skel-chip" />
            </div>
          </div>
        </div>
        <div className="identity-foot">
          <Line width="240px" />
          <Line width="120px" />
        </div>
      </div>
      <div className="grid-2">
        <Card>
          <HeadRow />
          <Line width="70%" />
          <Line width="46%" />
        </Card>
        <Card>
          <HeadRow />
          <Line width="64%" />
          <Line width="52%" />
        </Card>
      </div>
    </div>
  );
}

/** Settings / help / profile: no gateway data, keep it light. */
function GenericSkeleton() {
  return (
    <div className="page-skeleton">
      <div className="grid-2">
        <Card>
          <HeadRow />
          <Line width="82%" />
          <Line width="64%" />
          <Line width="72%" />
        </Card>
        <Card>
          <HeadRow />
          <div className="skel-row">
            <span className="skeleton skel-icon" />
            <div className="page-skeleton" style={{ display: "grid", gap: 8 }}>
              <Line width="140px" tall />
              <Line width="180px" />
            </div>
          </div>
          <Line width="58%" />
        </Card>
      </div>
    </div>
  );
}

export function PageSkeleton({ ariaLabel, path }: { ariaLabel?: string; path: string }) {
  const segments = path.split("/").filter(Boolean);
  const base = segments[0];
  const isDetail = segments.length > 1;

  let body: ReactNode;
  if (base === undefined) body = <OverviewSkeleton />;
  else if (base === "projects") body = isDetail ? <DetailSkeleton /> : <ProjectsSkeleton />;
  else if (base === "runs" || base === "suites" || base === "issues") body = isDetail ? <DetailSkeleton /> : <ListSkeleton />;
  else if (base === "reports") body = <ReportsSkeleton />;
  else if (base === "profile") body = <ProfileSkeleton />;
  else body = <GenericSkeleton />;

  return (
    <div aria-label={ariaLabel} className="page-skeleton" role="status">
      {body}
    </div>
  );
}
