import type { Diagnosis, LessonId } from './index.ts';

const result = (status: Diagnosis['status'], errorType: string, title: string, feedback: string, remediation: string[], reviewFrame: number): Diagnosis => ({status,errorType,title,feedback,remediation,reviewFrame});

/** Deterministic checkpoint evaluator; no model call and no execution of student code. */
export function evaluateAnswer(id: LessonId, raw: string): Diagnosis {
  const text = raw.trim().replaceAll('，', ',').replaceAll('−', '-').replaceAll('［','[').replaceAll('］',']');
  const invalid = () => result('invalid','INVALID_INPUT','先检查一下输入格式','请按照提示输入数字答案。',[],0);
  if (!text || text.length > 200) return invalid();
  if (id === 'two-sum') {
    const pair = text.match(/^(?:\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]|(-?\d+)\s*[,\s]\s*(-?\d+))$/);
    if (!pair) return invalid();
    const a=Number(pair[1] ?? pair[3]), b=Number(pair[2] ?? pair[4]);
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return invalid();
    if (a===b) return result('incorrect','REUSED_INDEX','一个位置不能用两次','题目要求两个不同的下标。即使 3 + 3 = 6，也不能重复使用下标 0。',['先查询已经走过的元素。','Map 里没有补数时，再存入当前元素。','这样命中时，两个下标一定来自不同位置。'],1);
    if ((a===1&&b===2)||(a===2&&b===1)) return result('correct','NONE','这个检查点答对了！','你找到了两个不同的下标：nums[1] + nums[2] = 6。',['记住：先查补数，再保存当前下标。'],5);
    if ((a===2&&b===4)||(a===4&&b===2)) return result('incorrect','VALUES_NOT_INDICES','找到数值了，再找它们的位置','2 和 4 确实相加为 6，但函数要求返回下标。',['数组下标从 0 开始。','数值 2 在第二格，下标是 1。','数值 4 在第三格，下标是 2。'],5);
    if (a<0||a>2||b<0||b>2) return result('incorrect','INDEX_OUT_OF_RANGE','下标超出数组范围','这个数组只有 3 项，有效下标为 0、1、2。',['先区分方格里的数值与方格下面的下标。','返回两个位置，而不是两个数值。'],0);
    return result('incorrect','SUM_MISMATCH','再核对两个位置上的数','所选位置上的两个数相加不等于 6。',['用 6 减去当前数，得到需要寻找的补数。','在 Map 中寻找补数已经出现的位置。'],3);
  }
  if (id !== 'longest-substring' || !/^-?\d+$/.test(text)) return invalid();
  const value=Number(text);
  if (value===2) return result('correct','NONE','你守住了窗口的边界！','left = Math.max(2, 0 + 1) = 2。旧 a 在窗口外，不会造成重复。',['左边界不能回退；当前窗口 ba 的长度是 2。'],5);
  if (value===1||value===0) return result('incorrect','LEFT_MOVED_BACKWARD','左边界不能向后退','旧 a 在下标 0，已经在窗口外。把 left 改成 1 会让窗口变为 bba。',['当前 left 是 2。','旧位置 + 1 等于 1，取 Math.max(2, 1)。','保留 left = 2，窗口 ba 中没有重复。'],4);
  return result('incorrect','WINDOW_BOUNDARY','先看重复字符是否还在窗口里','不是每次移动 right，都需要移动 left。当前 a 的旧位置已经在窗口外。',['比较当前左边界与旧位置加一。','Math.max(2, 0 + 1) 的结果是 2。'],4);
}
