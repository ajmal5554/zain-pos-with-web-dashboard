import React, { useEffect, useState } from 'react';
import { Plus, Edit, Search } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { db } from '../lib/db';

export const Customers: React.FC = () => {
    const [customers, setCustomers] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingCustomer, setEditingCustomer] = useState<any>(null);
    const [formData, setFormData] = useState({
        name: '',
        phone: '',
        email: '',
        address: '',
        gstin: '',
    });

    useEffect(() => {
        loadCustomers();
    }, []);

    const loadCustomers = async () => {
        try {
            const data = await db.customers.findMany({});
            setCustomers(data);
        } catch (error) {
            console.error('Failed to load customers:', error);
        }
    };

    const openAddModal = () => {
        setEditingCustomer(null);
        setFormData({ name: '', phone: '', email: '', address: '', gstin: '' });
        setShowModal(true);
    };

    const openEditModal = (customer: any) => {
        setEditingCustomer(customer);
        setFormData({
            name: customer.name || '',
            phone: customer.phone || '',
            email: customer.email || '',
            address: customer.address || '',
            gstin: customer.gstin || '',
        });
        setShowModal(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editingCustomer) {
                await db.customers.update({
                    where: { id: editingCustomer.id },
                    data: formData
                });
            } else {
                await db.customers.create({ data: formData });
            }
            setShowModal(false);
            setEditingCustomer(null);
            setFormData({ name: '', phone: '', email: '', address: '', gstin: '' });
            loadCustomers();
        } catch (error) {
            console.error('Failed to save customer:', error);
            alert('Failed to save customer');
        }
    };

    const filteredCustomers = customers.filter((c) =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.phone?.includes(searchQuery)
    );

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div className="flex-1 max-w-md">
                    <div className="relative">
                        <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                        <Input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search customers..."
                            className="pl-10"
                        />
                    </div>
                </div>
                <Button variant="primary" onClick={openAddModal}>
                    <Plus className="w-5 h-5" />
                    Add Customer
                </Button>
            </div>

            <div className="card overflow-x-auto">
                <table className="table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Phone</th>
                            <th>Email</th>
                            <th>GSTIN</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredCustomers.map((customer) => (
                            <tr key={customer.id}>
                                <td className="font-medium">{customer.name}</td>
                                <td>{customer.phone || '-'}</td>
                                <td>{customer.email || '-'}</td>
                                <td>{customer.gstin || '-'}</td>
                                <td>
                                    <Button variant="secondary" size="sm" onClick={() => openEditModal(customer)}>
                                        <Edit className="w-4 h-4" />
                                    </Button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <Modal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                title={editingCustomer ? 'Edit Customer' : 'Add New Customer'}
            >
                <form onSubmit={handleSubmit} className="space-y-4">
                    <Input
                        label="Name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                    />
                    <Input
                        label="Phone"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    />
                    <Input
                        label="Email"
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                    <Input
                        label="Address"
                        value={formData.address}
                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    />
                    <Input
                        label="GSTIN"
                        value={formData.gstin}
                        onChange={(e) => setFormData({ ...formData, gstin: e.target.value })}
                    />
                    <div className="flex gap-2 pt-4">
                        <Button type="submit" variant="primary" className="flex-1">
                            {editingCustomer ? 'Update Customer' : 'Add Customer'}
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setShowModal(false)}
                        >
                            Cancel
                        </Button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};
