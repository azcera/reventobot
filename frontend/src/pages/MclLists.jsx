import React, { useEffect, useState } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import { Button, Field, IconButton, Panel, useModal } from '../components/ui.jsx'

export function MclLists({ active, resources, api, run, notify, setConfig }) {
 const [lists, setLists] = useState(null)
 const [revision, setRevision] = useState(0)
 const modal = useModal()
 useEffect(() => { if (active && !lists) api('mcl-lists').then(data => { setLists(data.lists); setRevision(data.revision) }).catch(error => notify(error.message, true)) }, [active, lists, api, notify])
 if (!lists) return <p className="text-sm text-muted">Загрузка списков…</p>
 const edit = (id, key, value) => setLists(previous => previous.map(list => list.id === id ? { ...list, [key]: value } : list))
 const choose = (list, key, label, options) => <Field label={label}><select value={list[key]} onChange={event => edit(list.id, key, event.target.value)}><option value="">Не выбрано</option>{list[key] && !options.some(item => item.id === list[key]) && <option value={list[key]}>Недоступно · {list[key]}</option>}{options.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
 const input = (list, key, label, maxLength) => <Field label={label}><input value={list[key]} maxLength={maxLength} onChange={event => edit(list.id, key, event.target.value)} /></Field>
 return <div className="grid gap-6"><div className="callout">Списки в одном канале объединяются в одно сообщение. Команды доступны администраторам, ролям модераторов бота и выбранной роли доступа. Не более 6 списков из-за лимита команд Discord.</div>
 {lists.map((list, index) => <Panel key={list.id} title={list.title || `Список ${index + 1}`} action={<IconButton icon={Trash2} label="Удалить список" onClick={async () => { if (await modal({ title: 'Удалить список?', message: 'После сохранения список и его команды будут удалены.', confirm: 'Удалить' })) setLists(lists.filter(item => item.id !== list.id)) }} />}><div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
 {input(list, 'title', 'Заголовок списка', 100)}{choose(list, 'channelId', 'Канал публикации', resources.channels.filter(channel => channel.type === 0))}
 {choose(list, 'roleId', 'Роль участников', resources.roles)}{choose(list, 'accessRoleId', 'Дополнительная роль доступа', resources.roles)}
 {input(list, 'addName', 'Команда добавления', 32)}{input(list, 'removeName', 'Команда удаления', 32)}
 </div></Panel>)}
 <div className="flex flex-wrap justify-between gap-3"><Button icon={Plus} disabled={lists.length >= 6} onClick={() => setLists([...lists, { id: crypto.randomUUID(), title: `Список ${lists.length + 1}`, channelId: '', roleId: '', accessRoleId: '', addName: `Добавить в список ${lists.length + 1}`, removeName: `Убрать из списка ${lists.length + 1}` }])}>Добавить список</Button><Button variant="primary" icon={Save} onClick={() => run(async () => { let data; try { data = await api('mcl-lists', { lists, revision }) } catch (error) { if (error.message.startsWith('Настройки сохранены')) { const saved = await api('mcl-lists'); setRevision(saved.revision); setConfig(await api('config')) } throw error } setLists(data.lists); setRevision(data.revision); setConfig(await api('config')); notify('Списки сохранены и опубликованы.') })}>Сохранить и опубликовать</Button></div></div>
}
