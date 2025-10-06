// Quick test script to verify our title refresh API works
async function testTitleRefresh() {
    try {
        const response = await fetch('http://localhost:3001/api/titles/refresh', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('Status:', response.status);
        console.log('Status Text:', response.statusText);
        
        const result = await response.text();
        console.log('Response:', result);
        
        if (response.ok) {
            console.log('✅ Title refresh API working successfully!');
        } else {
            console.log('❌ Title refresh API failed');
        }
    } catch (error) {
        console.error('❌ Error testing API:', error.message);
    }
}

testTitleRefresh();