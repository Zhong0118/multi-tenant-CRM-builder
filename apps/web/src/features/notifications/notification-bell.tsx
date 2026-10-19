"use client";

import { BellOutlined, CheckOutlined, ClockCircleOutlined, InboxOutlined, PhoneOutlined, SafetyCertificateOutlined, ScheduleOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Badge, Button, Drawer, Empty, Pagination, Segmented, Spin } from "antd";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { notificationsApi, type NotificationItem, type NotificationPage, type NotificationsApi } from "./notification-api";
import styles from "./notifications.module.css";

interface Props {
  tenantCode: string;
  api?: NotificationsApi;
  onNavigate?: (href: string) => void;
}
const groups = {
  CONTACT_DUE: { label: "联系提醒", icon: <PhoneOutlined /> },
  FOLLOW_UP_DUE: { label: "跟进提醒", icon: <ScheduleOutlined /> },
  TASK_OVERDUE: { label: "待办提醒", icon: <ClockCircleOutlined /> },
  POOL_RECLAIMED: { label: "公海回收", icon: <InboxOutlined /> },
  PROTECTION_REVIEW: { label: "保护复核", icon: <SafetyCertificateOutlined /> },
};
const dateLabel = (value: string) => new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

// A company switch remounts the inbox, discarding its list, pagination and in-flight responses.
export function NotificationBell(props: Props) {
  return props.tenantCode ? <CompanyNotifications key={props.tenantCode} {...props} /> : null;
}
function CompanyNotifications({ tenantCode, api = notificationsApi, onNavigate }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [data, setData] = useState<NotificationPage>();
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const active = useRef(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++request.current;
    try {
      const result = await api.list(tenantCode, { page, limit: 20, unreadOnly });
      if (!active.current || request.current !== sequence) return;
      // A read action can empty the last page of the unread filter.
      const lastPage = Math.max(1, Math.ceil(result.total / result.limit));
      if (page > lastPage) { setPage(lastPage); return; }
      setData(result);
      setError(false);
    } catch {
      if (active.current && request.current === sequence) setError(true);
    } finally {
      if (active.current && request.current === sequence) setRefreshing(false);
    }
  }, [api, tenantCode, page, unreadOnly]);

  // A read action may finish after the user changes the filter or page.
  const currentRefresh = useRef(refresh);
  useEffect(() => { currentRefresh.current = refresh; }, [refresh]);

  useEffect(() => {
    active.current = true;
    // The external request updates state only after its response arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") void refresh(); }, 60_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      active.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);

  async function act(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try { await action(); }
    catch { if (active.current) setNotice("操作失败，请重试"); }
    finally { if (active.current) setBusy(false); }
  }
  async function read(item: NotificationItem, navigate: boolean) {
    await act(async () => {
      if (!item.readAt) await api.read(tenantCode, item.id);
      if (!active.current) return;
      await currentRefresh.current();
      if (!active.current) return;
      // The click always asks the server again; canOpen is only a display hint.
      if (navigate) {
        const target = await api.target(tenantCode, item.id);
        if (!active.current) return;
        if (target.href && target.href.startsWith(`/workspace/${encodeURIComponent(tenantCode)}/`)) {
          setOpen(false);
          (onNavigate ?? router.push)(target.href);
        } else setNotice("相关记录已失效或你已无权访问");
      }
    });
  }
  const unreadLabel = error ? "读取失败" : data ? `${data.unreadCount} 条未读` : "正在读取";
  return <>
    <Badge className={styles.badge} count={error ? "!" : data?.unreadCount} color="#1677ff" size="small" offset={[-4, 4]}>
      <Button type="text" icon={<BellOutlined />} className={styles.bell} aria-label={`打开消息，${unreadLabel}`} aria-expanded={open} onClick={() => setOpen(true)} />
    </Badge>
    <Drawer title="消息" open={open} onClose={() => setOpen(false)} size={440} rootClassName={styles.drawer} styles={{ wrapper: { maxWidth: "100vw" }, body: { padding: 0, overflowX: "hidden" } }} footer={<Pagination size="small" simple current={page} pageSize={20} total={data?.total ?? 0} showSizeChanger={false} onChange={(value) => { setData(undefined); setPage(value); }} />}>
      <div className={styles.toolbar}>
        <Segmented aria-label="消息筛选" value={unreadOnly ? "unread" : "all"} options={[{ label: "全部", value: "all" }, { label: "未读", value: "unread" }]} onChange={(value) => { setData(undefined); setPage(1); setUnreadOnly(value === "unread"); }} />
        <div className={styles.actions}>
          <Button type="text" icon={<ReloadOutlined />} aria-label="刷新消息" loading={refreshing} onClick={() => { setRefreshing(true); void refresh(); }} />
          <Button type="text" icon={<CheckOutlined />} disabled={!data?.unreadCount || error || busy} onClick={() => { if (data) void act(async () => { await api.readAll(tenantCode, data.serverTime, data.snapshot); if (active.current) await currentRefresh.current(); }); }}>全部已读</Button>
        </div>
      </div>
      {error && <Alert type="error" title="消息读取失败" description="暂时无法获取最新消息" action={<Button size="small" aria-label="重试" onClick={() => void refresh()}>重试</Button>} className={styles.feedback} />}
      {notice && <Alert type="info" title={notice} showIcon className={styles.feedback} />}
      {!data && !error && <div className={styles.loading}><Spin description="正在读取消息"><div className={styles.spinnerSpace} /></Spin></div>}
      {data && !data.items.length && !error && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={unreadOnly ? "暂无未读消息" : "暂无消息"} />}
      {data && <div className={styles.list} aria-busy={refreshing}>
        {Object.entries(groups).map(([kind, group]) => {
          const items = data.items.filter((item) => item.kind === kind);
          return items.length ? <section key={kind} aria-label={group.label}>
            <h3 className={styles.groupTitle}>{group.icon}{group.label}<span>{items.length}</span></h3>
            {items.map((item) => <article className={`${styles.item} ${!item.readAt ? styles.unread : ""}`} key={item.id}>
              <div className={styles.itemHeading}><h4>{item.title}</h4>{!item.readAt && <span className={styles.unreadDot} aria-label="未读" />}</div>
              <p>{item.message}</p>
              <div className={styles.itemMeta}><time dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time>{item.dueAt && <span>到期 {dateLabel(item.dueAt)}</span>}</div>
              <div className={styles.itemActions}>
                {!item.readAt && <Button size="small" type="text" disabled={busy} onClick={() => void read(item, false)}>标为已读</Button>}
                {item.canOpen ? <Button size="small" type="link" disabled={busy} onClick={() => void read(item, true)}>查看记录</Button> : <span className={styles.unavailable}>相关记录不可访问</span>}
              </div>
            </article>)}
          </section> : null;
        })}
      </div>}
    </Drawer>
  </>;
}
