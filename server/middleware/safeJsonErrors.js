export function createSafeJsonErrorHandler({ logger = console.warn } = {}) {
  return (error, request, response, next) => {
    if (error?.type !== 'entity.parse.failed') return next(error)

    const requestId = String(request.requestId || '')
    logger(
      '[request.invalid-json]',
      JSON.stringify({
        requestId,
        route: request.path,
        status: 400,
        code: 'INVALID_JSON',
      }),
    )
    return response.status(400).json({
      status: 'failed',
      code: 'INVALID_JSON',
      message: '请求数据格式不正确。',
      requestId,
    })
  }
}
