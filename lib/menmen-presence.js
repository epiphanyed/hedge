'use strict'

/**
 * 文档在线协同：进程内 Socket.IO 房间，不走 Redis。
 * 广播列表含这篇文档里仍 connected 的人（编辑权、查看权都算），不含已断开连接。
 */

function isLiveSocket (sock) {
  return !!(sock && sock.connected)
}

function getConnectedMap (io) {
  if (!io || !io.sockets) return {}
  return io.sockets.connected || {}
}

function collectPresentUsers (note, connectedMap) {
  const users = []
  if (!note || !note.users) return users
  Object.keys(note.users).forEach(function (socketId) {
    const user = note.users[socketId]
    if (!user) return
    if (!isLiveSocket(connectedMap[socketId])) return
    users.push(user)
  })
  return users
}

function findNoteIdBySocketId (notesMap, socketId) {
  if (!notesMap || !socketId) return null
  const ids = Object.keys(notesMap)
  for (let i = 0; i < ids.length; i++) {
    const note = notesMap[ids[i]]
    if (note && note.users && note.users[socketId]) return ids[i]
  }
  return null
}

function staleSocketIds (usersMap, connectedMap) {
  const stale = []
  Object.keys(usersMap || {}).forEach(function (id) {
    if (!isLiveSocket(connectedMap[id])) stale.push(id)
  })
  return stale
}

module.exports = {
  isLiveSocket,
  getConnectedMap,
  collectPresentUsers,
  findNoteIdBySocketId,
  staleSocketIds
}
