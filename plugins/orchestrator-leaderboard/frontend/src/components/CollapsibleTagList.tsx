import React from 'react';

/** Approximate max height for two rows of `CapabilityTag` size `sm` (py-1 + text-xs + gap-2). */
const COLLAPSED_TAG_LIST_MAX_HEIGHT_PX = 56;

interface CollapsibleTagListProps {
  children: React.ReactNode;
  emptyMessage?: React.ReactNode;
  isEmpty: boolean;
}

export const CollapsibleTagList: React.FC<CollapsibleTagListProps> = ({
  children,
  emptyMessage = null,
  isEmpty,
}) => {
  const tagsRef = React.useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [hasOverflow, setHasOverflow] = React.useState(false);

  const [hiddenCount, setHiddenCount] = React.useState(0);

  const measureOverflow = React.useCallback(() => {
    const el = tagsRef.current;
    if (!el || isEmpty) {
      setHasOverflow(false);
      setHiddenCount(0);
      return;
    }
    const overflows = el.scrollHeight > COLLAPSED_TAG_LIST_MAX_HEIGHT_PX + 1;
    setHasOverflow(overflows);

    if (!overflows) {
      setHiddenCount(0);
      return;
    }

    const tagElements = Array.from(el.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    if (tagElements.length === 0) {
      setHiddenCount(0);
      return;
    }
    const firstRowTop = tagElements[0].offsetTop;
    const visibleCount = tagElements.filter(
      (tag) => tag.offsetTop - firstRowTop < COLLAPSED_TAG_LIST_MAX_HEIGHT_PX - 2,
    ).length;
    setHiddenCount(Math.max(0, tagElements.length - visibleCount));
  }, [isEmpty]);

  React.useLayoutEffect(() => {
    measureOverflow();
  }, [children, measureOverflow, isEmpty]);

  React.useEffect(() => {
    const el = tagsRef.current;
    if (!el || isEmpty) {
      return undefined;
    }
    const observer = new ResizeObserver(() => measureOverflow());
    observer.observe(el);
    return () => observer.disconnect();
  }, [isEmpty, measureOverflow]);

  React.useEffect(() => {
    if (isEmpty) {
      setExpanded(false);
    }
  }, [isEmpty]);

  const showToggle = !isEmpty && (hasOverflow || expanded);

  let expandLabel = '+ more';
  if (expanded) {
    expandLabel = 'Hide';
  } else if (hiddenCount > 0) {
    expandLabel = `+ ${hiddenCount} more`;
  }

  return (
    <div className="space-y-1.5">
      <div
        ref={tagsRef}
        className={`flex flex-wrap gap-2 ${expanded ? '' : 'max-h-14 overflow-hidden'}`}
      >
        {isEmpty ? (
          <span className="text-xs text-text-muted">{emptyMessage}</span>
        ) : (
          children
        )}
      </div>
      {showToggle && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-md border border-accent-emerald/40 bg-accent-emerald/10 text-accent-emerald hover:bg-accent-emerald/20 hover:border-accent-emerald/60 transition-colors"
        >
          {expandLabel}
        </button>
      )}
    </div>
  );
};
