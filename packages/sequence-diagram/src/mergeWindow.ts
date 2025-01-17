import sha256 from 'crypto-js/sha256.js';
import { Action, Loop, NodeType } from './types';

function buildDigest(actions: Action[]): string {
  return sha256(actions.map((action) => action.subtreeDigest).join('\n')).toString();
}

function countDigests(actions: Action[], windowSize: number): Map<string, number> {
  const digestCount = new Map<string, number>();
  for (let index = 0; index + windowSize <= actions.length; index++) {
    const range = actions.slice(index, index + windowSize);
    const digest = buildDigest(range);
    const count = digestCount.get(digest);
    if (count !== undefined) digestCount.set(digest, count + 1);
    else digestCount.set(digest, 1);
  }
  return digestCount;
}

type Merge = Action[][];

const isMerge = (item: Merge | Action): item is Merge => item.constructor === Array;

const buildLoop = (merge: Merge): Loop => {
  const digest = buildDigest(merge[0]);

  // Since we are going to use merge[0] as the children of the loop, the event ids and elapsed time from the
  // loop actions that will be discarded need to be merged into merge[0]. This needs to happen
  // recursively in order to avoid losing event ids and elapsed time data from nested loops.
  const aggregateLoopMemberData = (action: Action, duplicates: Action[]): void => {
    action.eventIds = [...action.eventIds, ...duplicates.map((d) => d.eventIds).flat()].sort(
      (a, b) => a - b
    );
    action.elapsed =
      (action.elapsed || 0) + duplicates.reduce((sum, d) => sum + (d.elapsed || 0), 0);
    action.children.forEach((child, index) => {
      aggregateLoopMemberData(
        child,
        duplicates.map((d) => d.children[index])
      );
    });
  };
  merge[0].forEach((member, index) => {
    aggregateLoopMemberData(
      member,
      merge.slice(1).map((m) => m[index])
    );
  });

  return {
    nodeType: NodeType.Loop,
    count: merge.length,
    digest: 'loop',
    subtreeDigest: ['loop', digest].join(':'),
    children: merge[0],
    elapsed: merge[0].reduce((sum, action) => sum + (action.elapsed || 0), 0),
    eventIds: [],
  } as Loop;
};

const unroll = (items: (Merge | Action)[]): Action[] => {
  const result: Action[] = [];
  items.forEach((item) => {
    if (isMerge(item)) {
      if (item.length > 1) result.push(buildLoop(item));
      else result.push(...item[0]);
    } else result.push(item);
  });
  return result;
};

export function merge(actions: Action[], windowSize: number): Action[] | undefined {
  const digestCount = countDigests(actions, windowSize);
  const digestsSorted = [...digestCount.keys()]
    .filter((key) => digestCount.get(key)! > 1)
    .sort((a, b) => digestCount.get(b)! - digestCount.get(a)!);

  if (digestsSorted.length === 0) return;

  for (let digestIndex = 0; digestIndex < digestsSorted.length; digestIndex++) {
    const referenceDigest = digestsSorted[digestIndex];
    const result: (Merge | Action)[] = [];
    let merge: Merge | undefined = undefined;
    for (let actionIndex = 0; actionIndex + windowSize <= actions.length; ) {
      const window = actions.slice(actionIndex, actionIndex + windowSize);
      const windowDigest = buildDigest(window);
      if (windowDigest === referenceDigest) {
        if (merge) {
          merge.push(window);
        } else {
          merge = [window];
          result.push(merge);
        }
        actionIndex += windowSize;
      } else {
        merge = undefined;
        result.push(window[0]);
        actionIndex += 1;
      }
    }
    const hasLoop = result.filter((item) => isMerge(item) && item.length > 1).length > 0;
    if (hasLoop) return unroll(result);
  }
}
