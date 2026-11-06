export default async function handler(req, res) {
    const { corpName, address } = req.query;

    if (!corpName) {
        return res.status(400).json({ error: "상호명을 입력해 주세요." });
    }

    const apiKey = process.env.DATA_GO_KR_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "API 키가 설정되지 않았습니다." });
    }

    try {
        const cleanName = corpName.trim();
        
        // 1단계: 공공데이터포털(금융위원회 기업기본정보) 조회 시도
        const baseUrl = "https://apis.data.go.kr/1160100/service/GetCorpOutlineInfoService_v2/getCorpOutline_V2";
        const url = `${baseUrl}?serviceKey=${apiKey}&resultType=json&pageNo=1&numOfRows=5&corpNm=${encodeURIComponent(cleanName)}`;

        const response = await fetch(url);
        const text = await response.text();

        let itemList = [];
        try {
            const data = JSON.parse(text);
            const items = data?.response?.body?.items?.item;
            if (Array.isArray(items)) {
                itemList = items;
            } else if (items) {
                itemList = [items];
            }
        } catch (e) {
            // JSON 파싱 실패 시 무시하고 대안 로직으로 넘어감
        }

        // 2단계: 공공데이터에서 결과를 찾은 경우
        if (itemList.length > 0) {
            const target = itemList[0];
            return res.status(200).json({
                success: true,
                corpName: target.corpNm || cleanName,
                ceoNm: target.ceoNm || "정보없음",
                bizno: target.bizNo || "정보없음",
                crno: target.crno || "정보없음",
                phone: target.enpTlno || "정보없음",
                address: target.enpBsadr || (address || "정보없음"),
                status: "계속사업자 (공공데이터 인증)"
            });
        }

        // 3단계: 공공데이터에 정보가 없을 경우 -> 비즈노 등 외부 검색 유도 및 안내 결과 반환
        // (사용자가 비즈노에서 직접 확인 후 사업자번호로 정밀 조회할 수 있도록 안내 메시지 포함)
        return res.status(200).json({
            success: false,
            corpName: `${cleanName} (공공데이터 미등록)`,
            ceoNm: "비즈노(BizNo) 등에서 사업자번호 확인 필요",
            bizno: "조회 불가",
            crno: "정보없음",
            phone: "정보없음",
            address: address || "입력된 지역",
            status: "결과없음 (비즈노 직접 조회 권장)"
        });

    } catch (error) {
        return res.status(500).json({ error: "서버 내부 오류: " + error.message });
    }
}
