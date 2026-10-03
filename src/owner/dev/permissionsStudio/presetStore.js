'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { resolveRuntimePath } = require('../../../config/runtimePaths');

const dataDir = resolveRuntimePath(process.env.BOT_MODE, 'database');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'permissions-studio.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS permission_blueprints (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    source_guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    source_channel_id TEXT,
    source_role_id TEXT,
    channel_type INTEGER,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_permission_blueprints_owner ON permission_blueprints(owner_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_permission_blueprints_source_guild ON permission_blueprints(source_guild_id, updated_at DESC);
`);

const upsert = db.prepare(`
  INSERT INTO permission_blueprints (id, owner_id, source_guild_id, name, kind, source_channel_id, source_role_id, channel_type, payload, created_at, updated_at)
  VALUES (@id,@ownerId,@sourceGuildId,@name,@kind,@sourceChannelId,@sourceRoleId,@channelType,@payload,@createdAt,@updatedAt)
  ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, source_channel_id=excluded.source_channel_id,
    source_role_id=excluded.source_role_id, channel_type=excluded.channel_type, payload=excluded.payload, updated_at=excluded.updated_at
`);
const listStmt = db.prepare('SELECT * FROM permission_blueprints WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 100');
const getStmt = db.prepare('SELECT * FROM permission_blueprints WHERE id = ? AND owner_id = ?');
const deleteStmt = db.prepare('DELETE FROM permission_blueprints WHERE id = ? AND owner_id = ?');
const renameStmt = db.prepare('UPDATE permission_blueprints SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?');

function decode(row){if(!row)return null;let payload={};try{payload=JSON.parse(row.payload)||{};}catch{}return {id:row.id,ownerId:row.owner_id,sourceGuildId:row.source_guild_id,name:row.name,kind:row.kind,sourceChannelId:row.source_channel_id,sourceRoleId:row.source_role_id,channelType:row.channel_type,createdAt:row.created_at,updatedAt:row.updated_at,...payload};}
function list(ownerId){return listStmt.all(String(ownerId)).map(decode);}
function get(ownerId,id){return decode(getStmt.get(String(id),String(ownerId)));}
function save(ownerId,preset){const now=Date.now();upsert.run({id:preset.id,ownerId:String(ownerId),sourceGuildId:String(preset.sourceGuildId),name:preset.name,kind:preset.kind,sourceChannelId:preset.sourceChannelId||null,sourceRoleId:preset.sourceRoleId||null,channelType:Number.isInteger(preset.channelType)?preset.channelType:null,payload:JSON.stringify({overwrites:preset.overwrites||[],rolePermissions:preset.rolePermissions||null,roleName:preset.roleName||null}),createdAt:preset.createdAt||now,updatedAt:now});return get(ownerId,preset.id);}
function rename(ownerId,id,name){const clean=String(name||'').trim().slice(0,100);if(!clean)return null;const changed=renameStmt.run(clean,Date.now(),String(id),String(ownerId)).changes;if(!changed)return null;return get(ownerId,id);}
function remove(ownerId,id){return deleteStmt.run(String(id),String(ownerId)).changes>0;}

module.exports={list,get,save,rename,remove};
