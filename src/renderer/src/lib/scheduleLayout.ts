/** 为相交的时间区间分配独立列，首尾相接的安排可以复用一列。 */
export function layoutIntervals<T>(items: T[], range: (item: T) => { start: number; end: number }) {
  const sorted = items.map(item => ({ item, ...range(item), column: 0, columns: 1 }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let group: typeof sorted = [];
  let ends: number[] = [];
  let groupEnd = -Infinity;
  const flush = () => { for (const item of group) item.columns = ends.length; group = []; ends = []; };
  for (const item of sorted) {
    if (item.start >= groupEnd) flush();
    const available = ends.findIndex(end => end <= item.start);
    item.column = available < 0 ? ends.length : available;
    ends[item.column] = item.end;
    group.push(item);
    groupEnd = Math.max(groupEnd, item.end);
  }
  flush();
  return sorted;
}
