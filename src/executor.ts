export async function runWithTimeout<T>(
  promiseFn: () => Promise<T>,
  timeoutMs: number,
  toolName: string
): Promise<T> {
  let timer: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Tool execution timed out after ${timeoutMs}ms for "${toolName}"`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promiseFn(), timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}
