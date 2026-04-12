import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type SpaceMemberFull } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useSpaces } from '../context/SpaceContext';

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Владелец',
  ADMIN: 'Администратор',
  EDITOR: 'Редактор',
  READER: 'Читатель',
};

const ROLE_HIERARCHY: Record<string, number> = {
  OWNER: 4, ADMIN: 3, EDITOR: 2, READER: 1,
};

function rolesAssignableBy(myRole: string): string[] {
  const myLevel = ROLE_HIERARCHY[myRole] ?? 0;
  return Object.keys(ROLE_HIERARCHY).filter(
    (r) => (ROLE_HIERARCHY[r] ?? 0) < myLevel && r !== 'OWNER',
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function SpaceSettings() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const { user } = useAuth();
  const { refreshSpaces } = useSpaces();
  const navigate = useNavigate();

  const [spaceName, setSpaceName] = useState('');
  const [nameEditing, setNameEditing] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  const [members, setMembers] = useState<SpaceMemberFull[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [myRole, setMyRole] = useState('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('READER');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [roleUpdating, setRoleUpdating] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const loadMembers = async () => {
    if (!spaceId) return;
    try {
      const data = await api.getSpaceMembers(spaceId);
      setMembers(data);
      const me = data.find((m) => m.userId === user?.id);
      if (me) setMyRole(me.role);
    } catch {
      // ignore
    } finally {
      setMembersLoading(false);
    }
  };

  useEffect(() => {
    if (!spaceId) return;
    // load space name
    fetch(`/api/spaces/${spaceId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d: { name?: string }) => { if (d.name) setSpaceName(d.name); })
      .catch(() => {});
    void loadMembers();
  }, [spaceId]);

  useEffect(() => {
    if (nameEditing) nameRef.current?.focus();
  }, [nameEditing]);

  const saveName = async () => {
    if (!spaceName.trim()) return;
    setNameSaving(true);
    setNameError('');
    try {
      const updated = await api.renameSpace(spaceId!, spaceName.trim());
      setSpaceName(updated.name);
      setNameEditing(false);
      void refreshSpaces();
    } catch (e: unknown) {
      setNameError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setNameSaving(false);
    }
  };

  const invite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError('');
    setInviteSuccess('');
    try {
      await api.inviteMember(spaceId!, { email: inviteEmail.trim(), role: inviteRole });
      setInviteEmail('');
      setInviteSuccess('Приглашение отправлено');
      await loadMembers();
    } catch (e: unknown) {
      setInviteError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (memberId: string, userId: string, role: string) => {
    setRoleUpdating(memberId);
    try {
      await api.updateMemberRole(spaceId!, userId, role);
      await loadMembers();
    } catch {
      // ignore
    } finally {
      setRoleUpdating(null);
    }
  };

  const removeMember = async (memberId: string, userId: string) => {
    setRemoving(memberId);
    try {
      await api.removeMember(spaceId!, userId);
      await loadMembers();
    } catch {
      // ignore
    } finally {
      setRemoving(null);
    }
  };

  const deleteSpace = async () => {
    setDeleting(true);
    try {
      await api.deleteSpace(spaceId!);
      await refreshSpaces();
      navigate('/');
    } catch {
      setDeleting(false);
    }
  };

  const isOwner = myRole === 'OWNER';
  const isAdmin = myRole === 'ADMIN' || isOwner;
  const assignable = rolesAssignableBy(myRole);

  if (!isAdmin && !membersLoading) {
    return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Нет доступа</div>;
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
        <button className="btn btn-ghost" onClick={() => navigate(`/spaces/${spaceId}`)} style={{ padding: '4px 10px', fontSize: 13 }}>
          ← Назад
        </button>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Настройки пространства</h1>
      </div>

      {/* Название */}
      <section style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 24, marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Название</h2>
        {nameEditing ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              ref={nameRef}
              value={spaceName}
              onChange={(e) => setSpaceName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void saveName(); if (e.key === 'Escape') setNameEditing(false); }}
              style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 15, fontFamily: 'var(--font)' }}
            />
            <button className="btn btn-primary" onClick={() => void saveName()} disabled={nameSaving}>
              {nameSaving ? '…' : 'Сохранить'}
            </button>
            <button className="btn btn-ghost" onClick={() => setNameEditing(false)}>Отмена</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 500 }}>{spaceName}</span>
            <button className="btn btn-ghost" onClick={() => setNameEditing(true)} style={{ padding: '4px 10px', fontSize: 12 }}>
              Изменить
            </button>
          </div>
        )}
        {nameError && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{nameError}</div>}
      </section>

      {/* Участники */}
      <section style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 24, marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Участники</h2>

        {membersLoading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Загрузка…</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 12 }}>Пользователь</th>
                <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 12 }}>Роль</th>
                <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 12 }}>С</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isMe = m.userId === user?.id;
                const canEdit = !isMe && (ROLE_HIERARCHY[myRole] ?? 0) > (ROLE_HIERARCHY[m.role] ?? 0);
                return (
                  <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{
                          width: 30, height: 30, borderRadius: '50%',
                          background: m.user.avatarColor, color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 700, fontSize: 13, flexShrink: 0,
                        }}>
                          {m.user.name[0]?.toUpperCase()}
                        </span>
                        <div>
                          <div style={{ fontWeight: 500 }}>{m.user.name}{isMe && ' (вы)'}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '10px 10px' }}>
                      {canEdit && assignable.length > 0 ? (
                        <select
                          value={m.role}
                          disabled={roleUpdating === m.id}
                          onChange={(e) => void changeRole(m.id, m.userId, e.target.value)}
                          style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 13, fontFamily: 'var(--font)', background: 'var(--bg)', color: 'var(--text)' }}
                        >
                          {assignable.map((r) => (
                            <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{ROLE_LABELS[m.role] ?? m.role}</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 10px', color: 'var(--text-muted)', fontSize: 12 }}>
                      {formatDate(m.invitedAt)}
                    </td>
                    <td style={{ padding: '10px 10px', textAlign: 'right' }}>
                      {canEdit && (
                        <button
                          className="btn btn-ghost"
                          disabled={removing === m.id}
                          onClick={() => void removeMember(m.id, m.userId)}
                          style={{ padding: '4px 8px', fontSize: 12, color: 'var(--danger)' }}
                        >
                          {removing === m.id ? '…' : 'Удалить'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Приглашение */}
        <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Пригласить участника</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="email"
              placeholder="email@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void invite(); }}
              style={{ flex: 1, minWidth: 200, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14, fontFamily: 'var(--font)' }}
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14, fontFamily: 'var(--font)', background: 'var(--bg)', color: 'var(--text)' }}
            >
              {assignable.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={() => void invite()} disabled={inviting || !inviteEmail.trim()}>
              {inviting ? '…' : 'Пригласить'}
            </button>
          </div>
          {inviteError && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{inviteError}</div>}
          {inviteSuccess && <div style={{ fontSize: 12, color: 'var(--success)', marginTop: 6 }}>{inviteSuccess}</div>}
        </div>
      </section>

      {/* Опасная зона */}
      {isOwner && (
        <section style={{ background: 'var(--bg)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', padding: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--danger)', marginBottom: 12 }}>Опасная зона</h2>
          {!deleteConfirm ? (
            <button className="btn btn-danger" onClick={() => setDeleteConfirm(true)}>
              Удалить пространство
            </button>
          ) : (
            <div>
              <p style={{ fontSize: 14, marginBottom: 12 }}>Вы уверены? Это действие нельзя отменить. Все файлы и данные будут удалены.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-danger" onClick={() => void deleteSpace()} disabled={deleting}>
                  {deleting ? '…' : 'Да, удалить'}
                </button>
                <button className="btn btn-ghost" onClick={() => setDeleteConfirm(false)}>Отмена</button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
