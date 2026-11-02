import Businesses from '../admin/Businesses'
import Staff from '../admin/Staff'
import Fleet from '../ops/Fleet'
import { AdminOverview, AdminPayments, AdminOrders, FeesSettings } from '../admin/AdminPages'
import { Dispatch, LiveTrips, Disputes, RiderPay } from '../ops/OpsPages'
import { OwnerHome, OwnerOrders, Stock, MyCustomers, OwnerPayments, OwnerFeedback } from '../owner/OwnerPages'
import NewOrder from '../owner/NewOrder'
import Bulk from '../owner/Bulk'
import RiderApp from '../rider/RiderApp'
import { MyOrders, CustomerOrder, Addresses, AccountSettings } from '../customer/CustomerPages'
import { supabase } from '../../lib/supabase'

// Counts shown beside menu items (each is limited by the database to what the role may see).
const count = (table, build) => async () => {
  const { count: c } = await build(supabase.from(table).select('*', { count: 'exact', head: true }))
  return c || 0
}

// Every screen in Ọ̀nà, by role (spec v5). Menus and routes are generated from this list;
// `group` sets the sidebar section.
export const SCREENS = {
  super_admin: [
    { path: '/', label: 'Overview', icon: 'overview', end: true, group: 'Today', component: AdminOverview },
    { path: '/payments', label: 'Payments', icon: 'receipt', group: 'Today', component: AdminPayments, count: count('payments', (q) => q.eq('status', 'pending')) },
    { path: '/orders', label: 'All orders', icon: 'box', group: 'Today', component: AdminOrders },
    { path: '/businesses', label: 'Businesses', icon: 'store', group: 'People', component: Businesses },
    { path: '/staff', label: 'Staff', icon: 'people', group: 'People', component: Staff },
    { path: '/riders', label: 'Riders & vehicles', icon: 'bike', group: 'People', component: () => <Fleet readOnly /> },
    { path: '/rider-pay', label: 'Rider pay', icon: 'money', group: 'People', component: RiderPay },
    { path: '/fees', label: 'Fees & slots', icon: 'sliders', group: 'Settings', component: FeesSettings },
  ],
  operations: [
    { path: '/', label: 'Dispatch', icon: 'route', end: true, group: 'Today', component: Dispatch, count: count('orders', (q) => q.eq('status', 'ready_for_pickup')) },
    { path: '/trips', label: 'Live trips', icon: 'live', group: 'Today', component: LiveTrips, count: count('routes', (q) => q.in('status', ['offered', 'active'])) },
    { path: '/disputes', label: 'Disputes & claims', icon: 'shield', group: 'Today', component: Disputes, count: count('issues', (q) => q.eq('status', 'open')) },
    { path: '/fleet', label: 'Riders & vehicles', icon: 'bike', group: 'Fleet', component: Fleet },
    { path: '/rider-pay', label: 'Rider pay', icon: 'money', group: 'Fleet', component: RiderPay },
  ],
  owner: [
    { path: '/', label: 'Home', icon: 'overview', end: true, group: 'Today', component: OwnerHome },
    { path: '/orders', label: 'Orders', icon: 'box', group: 'Today', component: OwnerOrders, count: count('orders', (q) => q.eq('status', 'received')) },
    { path: '/new-order', label: 'New order', icon: 'plus', group: 'Today', component: NewOrder },
    { path: '/payments', label: 'Payments', icon: 'card', group: 'Today', component: OwnerPayments, count: count('dispatch_requests', (q) => q.eq('status', 'awaiting_payment')) },
    { path: '/stock', label: 'Stock', icon: 'layers', group: 'Business', component: Stock },
    { path: '/bulk', label: 'Bulk orders', icon: 'upload', group: 'Business', component: Bulk },
    { path: '/customers', label: 'My customers', icon: 'people', group: 'Business', component: MyCustomers },
    { path: '/feedback', label: 'Feedback & claims', icon: 'star', group: 'Business', component: OwnerFeedback },
  ],
  rider: [
    { path: '/', label: 'My route', icon: 'route', end: true, group: 'Work', component: RiderApp },
  ],
  customer: [
    { path: '/', label: 'My orders', icon: 'box', end: true, group: 'Deliveries', component: MyOrders },
    { path: '/orders/:id', label: 'Order', icon: 'box', hidden: true, component: CustomerOrder },
    { path: '/addresses', label: 'Addresses', icon: 'pin', group: 'Deliveries', component: Addresses },
    { path: '/account-settings', label: 'Account', icon: 'user', group: 'You', component: AccountSettings },
  ],
}
