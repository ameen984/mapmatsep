// Initialize Supabase client
const supabaseUrl = 'YOUR_SUPABASE_URL';
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const buildingId = urlParams.get('buildingId');
    
    console.log('Building ID from URL:', buildingId);
    
    if (buildingId) {
        await loadDepartments(buildingId);
    } else {
        document.getElementById('departmentsContent').innerHTML = '<p>No building selected.</p>';
    }
});

async function loadDepartments(buildingId) {
    try {
        console.log('Fetching departments for building ID:', buildingId);
        
        const { data: departments, error } = await supabase
            .from('departments')
            .select('*')
            .eq('building_id', buildingId);

        if (error) {
            console.error('Supabase error:', error);
            throw error;
        }

        console.log('Fetched departments:', departments);

        const departmentsContent = document.getElementById('departmentsContent');
        
        if (departments && departments.length > 0) {
            departmentsContent.innerHTML = departments.map(dept => `
                <div class="department-card">
                    <div class="department-header">
                        <span class="department-name">${dept.dept_name}</span>
                        <span class="department-stats">${dept.student_count} Students</span>
                    </div>
                    <div class="department-details">
                        <div class="detail-item">
                            <span class="detail-label">Head of Department</span>
                            <span class="detail-value">${dept.HOD || 'N/A'}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Contact</span>
                            <span class="detail-value">${dept.contact || 'N/A'}</span>
                        </div>
                    </div>
                </div>
            `).join('');
        } else {
            departmentsContent.innerHTML = '<p>No departments found for this building.</p>';
        }
    } catch (error) {
        console.error('Error loading departments:', error);
        document.getElementById('departmentsContent').innerHTML = '<p>Error loading departments. Please try again later.</p>';
    }
} 