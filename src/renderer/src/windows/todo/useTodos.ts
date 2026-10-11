/**
 * 待办数据 hook：getTodos 拉初值 + onTodosChanged 订阅主进程广播。
 * 单向数据流：所有变更只发 todosMutate，本地 state 一律等主进程广播回来再改（无本地乐观更新，
 * 双窗口一致性由主进程唯一写方保证）。
 */

import { useCallback, useEffect, useState } from 'react'
import type { TodosMutateMsg } from '../../../../shared/ipc'
import type { Todo } from '../../../../shared/types'

export function useTodos(): { todos: Todo[]; mutate: (msg: TodosMutateMsg) => void } {
  const [todos, setTodos] = useState<Todo[]>([])

  useEffect(() => {
    let disposed = false
    window.api
      .getTodos()
      .then((list) => {
        if (!disposed) setTodos(list)
      })
      .catch((err: unknown) => console.error('[todo] getTodos 失败:', err))
    const off = window.api.onTodosChanged((list) => setTodos(list))
    return () => {
      disposed = true
      off()
    }
  }, [])

  const mutate = useCallback((msg: TodosMutateMsg): void => {
    window.api.todosMutate(msg)
  }, [])

  return { todos, mutate }
}
