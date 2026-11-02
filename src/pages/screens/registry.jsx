import Businesses from '../admin/Businesses'
import Staff from '../admin/Staff'
import Fleet from '../ops/Fleet'

// Every screen in Ọ̀nà, by role, with the functions it must provide (spec v5).
// Pages marked phase > 0 are placeholders until that phase is built.
export const SCREENS = {
  super_admin: [
    { path: '/', label: 'Overview', icon: 'overview', end: true, phase: 5, does: ['Businesses, customers, riders available, deliveries, success rate', 'Revenue: delivery fees and waiting charges', 'Issues feed with Prompt business', 'Receipts waiting, against the 15-minute target'] },
    { path: '/payments', label: 'Payments', icon: 'receipt', phase: 3, does: ['Receipts to check, with wait time', 'Confirm (releases orders to dispatch) or reject with a reason', 'Third rejection closes the request', 'Credits and waiting charges'] },
    { path: '/businesses', label: 'Businesses', icon: 'store', phase: 1, component: Businesses, does: ['Add a business and e-mail its owner a set-password link', 'Deliveries, fees paid, customers, complaints, packing issues', 'Deactivate a business'] },
    { path: '/fees', label: 'Fees & slots', icon: 'sliders', phase: 3, does: ['Fee table by vehicle and distance band', 'Waiting charge ₦200 per 5 min after 10 free', 'Delivery slots, capacity 15 per zone, 1-hour payment cut-off', 'Claim limit ₦100,000; 48 h / 24 h deadlines'] },
    { path: '/staff', label: 'Staff', icon: 'people', phase: 1, component: Staff, does: ['Create and deactivate Operations accounts'] },
    { path: '/riders', label: 'Riders & vehicles', icon: 'bike', phase: 1, component: () => <Fleet readOnly />, does: ['Rider history, availability, documents and pay'] },
  ],
  operations: [
    { path: '/', label: 'Dispatch', icon: 'route', end: true, phase: 4, does: ['Queue of paid orders from every business', 'Suggested combined routes: accept, edit or keep separate', 'Assign riders whose vehicle fits and papers are valid', 'Live map'] },
    { path: '/trips', label: 'Live trips', icon: 'live', phase: 4, does: ['Arrival and waiting timers, ₦200 charges', 'Failed pickups and reassignment', 'Traffic alerts, stale-trip alerts', 'Swap rider mid-trip with a handover code'] },
    { path: '/disputes', label: 'Disputes & claims', icon: 'shield', phase: 5, does: ['Override a locked delivery code after phoning the customer (reason, audit log)', 'Claims: compare pickup and door photos', 'Rider-caused: refund goods value up to ₦100,000; store-caused: send to business', 'Delivery complaints (late, rider conduct)'] },
    { path: '/fleet', label: 'Riders & vehicles', icon: 'bike', phase: 1, component: Fleet, does: ['Create riders (temporary password) and vehicles', 'Attach rider to vehicle; availability, licence expiry, pause', 'Rider pay (not shown to riders)', 'Create dispatch staff accounts'] },
  ],
  owner: [
    { path: '/', label: 'Orders', icon: 'box', end: true, phase: 3, does: ['Orders board; pack with a checklist', 'Tick several packed orders and request dispatch', 'One transfer and one receipt for several orders', 'At pickup: rider name, photo and plate, pickup code, “Need 10 more minutes”'] },
    { path: '/new-order', label: 'New order', icon: 'plus', phase: 2, does: ['Pick items from stock', 'Customer e-mail with typo check (no customer search)', 'Delivery slot; address entered or chosen by the customer', 'Vehicle and fee suggested'] },
    { path: '/bulk', label: 'Bulk orders', icon: 'upload', phase: 2, does: ['Upload a spreadsheet of orders; bad rows listed'] },
    { path: '/stock', label: 'Stock', icon: 'layers', phase: 2, does: ['Stock in, Sold in shop, adjustments with reasons', 'On hand, reserved, available; item sizes'] },
    { path: '/customers', label: 'My customers', icon: 'people', phase: 2, does: ['Only people this business has sent orders to'] },
    { path: '/payments', label: 'Payments', icon: 'card', phase: 3, does: ['Fees, receipt status, waiting charges, credits, claim refunds'] },
    { path: '/performance', label: 'Performance', icon: 'chart', phase: 5, does: ['On time (traffic shown separately), completion, failures by reason', 'Cost per delivery, waiting charges, packing issues, riders who delivered'] },
    { path: '/feedback', label: 'Feedback', icon: 'chat', phase: 5, does: ['Ratings and goods complaints; store-caused claims with the pickup photo'] },
  ],
  rider: [
    { path: '/', label: 'My route', icon: 'route', end: true, phase: 4, does: ['Accept or decline routes', 'Arrived at shop (location check), waiting timer', 'Photograph bags, type the pickup code; failed pickup after 20/30 min', 'Map links, location shared only during a trip', 'Photograph the handover, type the delivery code', 'Report a problem; hand over to a new rider with a code'] },
  ],
  customer: [
    { path: '/', label: 'My orders', icon: 'box', end: true, phase: 2, does: ['Orders from every business that has sent one'] },
    { path: '/orders/:id', label: 'Order', icon: 'box', hidden: true, phase: 4, does: ['Choose or correct the address until packed', 'Packed → rider assigned (name, number, vehicle, plate) → picked up', 'Live map, arrival time, traffic and rider-change notices', 'Check items, then show the delivery code', 'Rate, good-condition answer, report a problem'] },
    { path: '/addresses', label: 'Addresses', icon: 'pin', phase: 2, does: ['Saved addresses, private to the customer'] },
    { path: '/account-settings', label: 'Account', icon: 'user', phase: 2, does: ['Businesses that can send you orders (Allowed / Stopped)'] },
  ],
}
