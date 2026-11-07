
export default async function handler(req, res) {
    const { corpName, address = "" } = req.query;

    if (req.method !== "GET") {
        return res.status(405).json({
            success: false,
            error: "GET 요청만 허용됩니다."
        });
    }

    if (!corpName || !corpName.trim()) {
        return res.status(400).json({
            success: false,
            error: "상호명을 입력해 주세요."
        });
    }

    const apiKey = process.env.DATA_GO_KR_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            success: false,
            error: "Vercel API 인증키가 설정되지 않았습니다."
        });
    }

    try {
        const cleanName = corpName.trim();

        // 1. 금융위원회 기업기본정보 API
        const baseUrl =
            "https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2";

        const params = new URLSearchParams({
            serviceKey: apiKey,
            resultType: "json",
            pageNo: "1",
            numOfRows: "20",
            corpNm: cleanName
        });

        const response = await fetch(
            `${baseUrl}?${params.toString()}`
        );

        const rawText = await response.text();

        // 2. HTTP 통신 오류
        if (!response.ok) {
            return res.status(502).json({
                success: false,
                error: `공공데이터 HTTP 오류: ${response.status}`,
                detail: rawText.substring(0, 500)
            });
        }

        // 3. JSON 변환 오류
        let data;

        try {
            data = JSON.parse(rawText);
        } catch {
            return res.status(502).json({
                success: false,
                error: "공공데이터 응답이 JSON 형식이 아닙니다.",
                detail: rawText.substring(0, 500)
            });
        }

        // 4. API 응답 헤더 확인
        const header = data?.response?.header;

        if (!header || header.resultCode !== "00") {
            return res.status(502).json({
                success: false,
                error: "금융위원회 API 오류",
                resultCode: header?.resultCode || "확인불가",
                resultMsg: header?.resultMsg || "응답 헤더가 없습니다."
            });
        }

        // 5. 검색 결과 배열 처리
        const body = data?.response?.body;
        const items = body?.items?.item;

        let itemList = [];

        if (Array.isArray(items)) {
            itemList = items;
        } else if (items) {
            itemList = [items];
        }

        const totalCount = Number(body?.totalCount || 0);

        if (itemList.length === 0) {
            return res.status(200).json({
                success: false,
                corpName: cleanName,
                ceoNm: "정보없음",
                bizno: "정보없음",
                crno: "정보없음",
                phone: "정보없음",
                address: "검색 결과가 없습니다.",
                status: "결과없음",
                totalCount: totalCount
            });
        }

        // 6. 상호명 비교를 위한 정규화
        function normalize(value) {
            return String(value || "")
                .replace(/\s/g, "")
                .replace(/[()（）]/g, "")
                .replace(/주식회사/g, "")
                .replace(/㈜/g, "")
                .toLowerCase();
        }

        const searchName = normalize(cleanName);
        const searchAddress = normalize(address);

        // 상호명이 정확히 일치하는 기업 우선
        let target = itemList.find(item =>
            normalize(item.corpNm) === searchName
        );

        // 정확한 상호명이 없으면 주소 일치 여부 확인
        if (!target && searchAddress) {
            target = itemList.find(item =>
                normalize(item.enpBsadr).includes(searchAddress)
            );
        }

        // 그래도 없으면 첫 번째 후보 사용
        if (!target) {
            target = itemList[0];
        }

        // 7. 최종 결과 반환
        return res.status(200).json({
            success: true,

            corpName: target.corpNm || cleanName,

            // 실제 API 응답 필드명 적용
            ceoNm: target.enpRprFnm || "정보없음",
            bizno: target.bzno || "정보없음",
            crno: target.crno || "정보없음",
            phone: target.enpTlno || "정보없음",
            address: target.enpBsadr || "정보없음",

            // 금융위원회 API만으로 사업자상태를 확정하지 않음
            status: "국세청 상태조회 필요",

            totalCount: totalCount,
            returnedCount: itemList.length,

            source: "금융위원회 기업기본정보"
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: "서버 통신 실패",
            detail: error.message
        });
    }
}

