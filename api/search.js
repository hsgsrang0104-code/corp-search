<script>
async function searchCorp() {
    const corpName = document.getElementById('corpName').value.trim();
    const address = document.getElementById('address').value.trim();
    const loading = document.getElementById('loading');
    const resultBox = document.getElementById('resultBox');
    const errorMessage = document.getElementById('errorMessage');
    const searchButton = document.getElementById('searchButton');

    if (!corpName) {
        alert("상호명을 입력해 주세요.");
        document.getElementById('corpName').focus();
        return;
    }

    resultBox.style.display = 'none';
    errorMessage.style.display = 'none';
    errorMessage.innerText = '';

    loading.style.display = 'block';
    searchButton.disabled = true;
    searchButton.innerText = '조회 중...';

    try {
        // [1단계] 브라우저(클라이언트)에서 직접 비즈노 API 호출 (국내 IP 활용)
        // ※ 본인의 비즈노 API Key를 여기에 입력하거나 설정에서 불러오도록 합니다.
        const biznoApiKey = "HhBUJ3jOITJpAxdtEcKm20SZlTBoIwdN"; // 본인 키 입력
        const biznoUrl = `https://bizno.net/api/fapi?key=${encodeURIComponent(biznoApiKey)}&gb=3&q=${encodeURIComponent(corpName)}&type=json`;

        const biznoResponse = await fetch(biznoUrl);
        if (!biznoResponse.ok) {
            throw new Error(`비즈노 API 통신 실패 (HTTP 상태: ${biznoResponse.status})`);
        }

        const biznoData = await biznoResponse.json();
        if (biznoData.resultCode !== 0 && biznoData.resultCode !== "0") {
            throw new Error(`비즈노 검색 결과 없음: ${biznoData.resultMsg || '결과 없음'}`);
        }

        const rawItems = biznoData.items;
        let itemList = Array.isArray(rawItems) ? rawItems : (rawItems ? [rawItems] : []);

        if (itemList.length === 0) {
            throw new Error("해당 상호명으로 등록된 기업정보가 비즈노에 없습니다.");
        }

        // 주소 매칭 함수
        function normalize(val) {
            return String(val || "").replace(/주식회사|㈜|\(주\)|주\)/g, "").replace(/\s/g, "").replace(/[()（）]/g, "").toLowerCase();
        }

        const searchName = normalize(corpName);
        const rankedItems = itemList.map(item => {
            const companyName = normalize(item.company);
            const companyAddress = item.address || item.addr || "";
            let score = 0;
            if (companyName === searchName) score += 100;
            else if (companyName.includes(searchName) || searchName.includes(companyName)) score += 50;
            if (address && companyAddress.includes(address)) score += 100;
            return { item, score };
        });

        rankedItems.sort((a, b) => b.score - a.score);
        const target = rankedItems[0].item;

        // [2단계 & 3단계] 확보한 사업자번호로 국세청 및 금융위 검증을 위해 백엔드 호출
        const params = new URLSearchParams({
            corpName: target.company || corpName,
            bizno: target.bno || "",
            address: target.address || target.addr || address
        });

        const verifyResponse = await fetch(`/api/verify?${params.toString()}`);
        const verifyData = await verifyResponse.json();

        if (!verifyResponse.ok || verifyData.success === false) {
            throw new Error(verifyData.error || "추가 검증 중 오류가 발생했습니다.");
        }

        // 화면에 결과 출력
        document.getElementById('res-corpName').innerText = verifyData.corpName || '정보없음';
        document.getElementById('res-ceoNm').innerText = verifyData.ceoNm || '정보없음';
        document.getElementById('res-bizno').innerText = verifyData.bizno || '정보없음';
        document.getElementById('res-crno').innerText = verifyData.crno || '정보없음';
        document.getElementById('res-phone').innerText = verifyData.phone || '정보없음';
        document.getElementById('res-address').innerText = verifyData.address || '정보없음';
        document.getElementById('res-status').innerText = verifyData.status || '조회 결과 없음';

        document.getElementById('resultCount').innerText =
            `전체 검색 결과 ${biznoData.totalCount ?? itemList.length}건 / 반환 결과 ${itemList.length}건`;

        resultBox.style.display = 'block';

    } catch (error) {
        console.error("조회 오류:", error);
        errorMessage.innerText = "조회 중 오류가 발생했습니다.\n\n" + error.message;
        errorMessage.style.display = 'block';
    } finally {
        loading.style.display = 'none';
        searchButton.disabled = false;
        searchButton.innerText = '조회하기';
    }
}

document.getElementById('corpName').addEventListener('keydown', e => { if (e.key === 'Enter') searchCorp(); });
document.getElementById('address').addEventListener('keydown', e => { if (e.key === 'Enter') searchCorp(); });
</script>
