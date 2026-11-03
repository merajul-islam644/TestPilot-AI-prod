/** Circle avatar that shows the uploaded picture when there is one, initials otherwise. */
export function UserAvatar({ initials, size, url }: { initials: string; size: "sm" | "lg" | "xl"; url?: string }) {
  if (url) {
    return <img alt="" className={`avatar avatar-${size} avatar-img`} draggable={false} src={url} />;
  }
  return <span className={`avatar avatar-${size}`}>{initials}</span>;
}
