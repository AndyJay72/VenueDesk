// ── API MODULE ──
import { Auth, API_BASE } from './auth.js';

async function request(path, opts = {}) {
    const url = `${API_BASE}${path}`;
    const res = await fetch(url, {
        ...opts,
        headers: { ...Auth.headers(), ...(opts.headers || {}) }
    });
    if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
    return res.json();
}

function withTenant(params = {}) {
    const tid = Auth.getTenantId();
    const p = new URLSearchParams({ ...params, tenant_id: tid });
    return `?${p.toString()}`;
}

export const API = {
    // Dashboard
    getDashboard: ()         => request(`/staff-dashboard${withTenant()}`),
    // Bookings
    getBookings:  (p={})     => request(`/get-bookings${withTenant(p)}`),
    getAllBookings:(p={})     => request(`/calendar-all-bookings${withTenant(p)}`),
    getPendingRequests:(p={}) => request(`/get-pending-requests${withTenant(p)}`),
    createBooking:(data)      => request('/create-booking', { method:'POST', body: JSON.stringify({ ...data, tenant_id: Auth.getTenantId() }) }),
    cancelBooking:(id)        => request('/cancel-booking', { method:'POST', body: JSON.stringify({ booking_id: id, tenant_id: Auth.getTenantId() }) }),
    // Customers
    getCustomers: (p={})     => request(`/get-customers${withTenant(p)}`),
    getCustomerHistory:(id)   => request(`/get-customer-history${withTenant({ customer_id: id })}`),
    // Rooms
    getRooms:    (p={})      => request(`/get-rooms${withTenant(p)}`),
    addRoom:     (data)      => request('/add-room',    { method:'POST', body: JSON.stringify({ ...data, tenant_id: Auth.getTenantId() }) }),
    updateRoom:  (data)      => request('/update-room', { method:'POST', body: JSON.stringify({ ...data, tenant_id: Auth.getTenantId() }) }),
    deleteRoom:  (id)        => request('/delete-room', { method:'POST', body: JSON.stringify({ room_id: id, tenant_id: Auth.getTenantId() }) }),
    // Event Types
    getEventTypes:(p={})     => request(`/get-event-types${withTenant(p)}`),
    addEventType: (data)     => request('/add-event-type',    { method:'POST', body: JSON.stringify({ ...data, tenant_id: Auth.getTenantId() }) }),
    updateEventType:(data)   => request('/update-event-type', { method:'POST', body: JSON.stringify({ ...data, tenant_id: Auth.getTenantId() }) }),
    deleteEventType:(id)     => request('/delete-event-type', { method:'POST', body: JSON.stringify({ event_type_id: id, tenant_id: Auth.getTenantId() }) }),
    // Pricing
    getPricing:  ()          => request(`/get-service-data${withTenant()}`),
    addPrice:    (data)      => request('/add-price',    { method:'POST', body: JSON.stringify({ ...data, tenant_id: Auth.getTenantId() }) }),
    deletePrice: (data)      => request('/delete-price', { method:'POST', body: JSON.stringify({ ...data, tenant_id: Auth.getTenantId() }) }),
    // Services
    getServices: ()          => request(`/get-service-data${withTenant()}`),
    addService:  (data)      => request('/add-service',    { method:'POST', body: JSON.stringify({ ...data, tenant_id: Auth.getTenantId() }) }),
    updateService:(data)     => request('/update-service', { method:'POST', body: JSON.stringify({ ...data, tenant_id: Auth.getTenantId() }) }),
    deleteService:(id)       => request('/delete-service', { method:'POST', body: JSON.stringify({ service_id: id, tenant_id: Auth.getTenantId() }) }),
    // Users
    getUsers:    ()          => request(`/get-users${withTenant()}`),
    createUser:  (data)      => request('/create-user', { method:'POST', body: JSON.stringify({ ...data, tenant_id: Auth.getTenantId() }) }),
    deleteUser:  (id)        => request('/delete-user', { method:'POST', body: JSON.stringify({ user_id: id, tenant_id: Auth.getTenantId() }) }),
    // Calendar / Blocked dates
    getBlockedDates:()       => request(`/blocked-dates${withTenant()}`),
    addBlockedDate:(data)    => request('/add-blocked-date',    { method:'POST', body: JSON.stringify({ ...data, tenant_id: Auth.getTenantId() }) }),
    deleteBlockedDate:(id)   => request('/delete-blocked-date', { method:'POST', body: JSON.stringify({ block_id: id, tenant_id: Auth.getTenantId() }) }),
    // Payments / Accounts
    getOutstanding:()        => request(`/get-outstanding-bookings${withTenant()}`),
    payBalance:  (data)      => request('/pay-balance', { method:'POST', body: JSON.stringify({ ...data, tenant_id: Auth.getTenantId() }) }),
    getAccountsData:()       => request(`/accounts-data${withTenant()}`),
    // Audit log
    getInteractions:(p={})   => request(`/customer-interactions${withTenant(p)}`),
    // Availability
    checkAvailability:(data) => request('/check-availability', { method:'POST', body: JSON.stringify({ ...data, tenant_id: Auth.getTenantId() }) }),
    // Enquiry
    submitEnquiry:(data)     => fetch(`${API_BASE}/d057a40e-fb3e-402a-8ed7-fe16bce70feb`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) }).then(r => r.json()),
    // Tenants
    getTenants:  ()          => request('/get-tenants'),
};
